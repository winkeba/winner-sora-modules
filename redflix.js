// ============================================================
// Redflix Module for Sora
// Site: https://redflix.co
// Mode: Async JS
// Type: Movies & Shows
// ============================================================

async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const response = await fetchv2(`https://redflix.co/browse?q=${encodedKeyword}`, {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://redflix.co/'
        });

        const html = await response.text();
        const results = [];

        // Match movie/show cards — href, title, and TMDB poster image
        const cardRegex = /<a[^>]+href="(https:\/\/redflix\.co\/(?:movie|tv)\/[^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<(?:h2|h3|span)[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/(?:h2|h3|span)>/gi;

        let match;
        while ((match = cardRegex.exec(html)) !== null) {
            const href = match[1].replace('/watch', '').trim();
            const image = match[2].trim();
            const title = match[3].trim();
            if (title && href) {
                results.push({ title, image, href });
            }
        }

        // Fallback: broader pattern if no results found above
        if (results.length === 0) {
            const altCardRegex = /<a[^>]+href="(https:\/\/redflix\.co\/(?:movie|tv)\/[^"/]+)"[^>]*>[\s\S]{0,600}?<img[^>]+src="(https:\/\/image\.tmdb\.org\/[^"]+)"[\s\S]{0,200}?<\/a>/gi;
            while ((match = altCardRegex.exec(html)) !== null) {
                const href = match[1].trim();
                const image = match[2].trim();

                // Try to extract title from slug
                const slugMatch = href.match(/\/(?:movie|tv)\/([^/]+)/);
                if (slugMatch) {
                    const title = slugMatch[1]
                        .replace(/-\d+$/, '')          // remove trailing ID
                        .replace(/-/g, ' ')             // dashes → spaces
                        .replace(/\b\w/g, c => c.toUpperCase()); // title case
                    results.push({ title, image, href });
                }
            }
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log('searchResults error:', error);
        return JSON.stringify([{ title: 'Error loading results', image: '', href: '' }]);
    }
}

async function extractDetails(url) {
    try {
        // Normalise: strip /watch suffix if present
        const cleanUrl = url.replace(/\/watch\/?$/, '');

        const response = await fetchv2(cleanUrl, {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://redflix.co/'
        });

        const html = await response.text();

        // Description / overview
        const descMatch = html.match(/<(?:p|div)[^>]*class="[^"]*(?:overview|description|synopsis|plot)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/) ||
                          html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/) ||
                          html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/);
        const description = descMatch
            ? descMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim()
            : 'No description available.';

        // Year / air date
        const yearMatch = html.match(/(?:Released?|Aired?|Year)[^<]{0,30}(\d{4})/) ||
                          html.match(/<meta[^>]+property="video:release_date"[^>]+content="(\d{4})[^"]*"/) ||
                          html.match(/(\d{4})/);
        const airdate = yearMatch ? yearMatch[1] : 'Unknown';

        // Aliases / genres or tagline
        const aliasMatch = html.match(/<(?:span|div|p)[^>]*class="[^"]*(?:genre|tag|alias|tagline)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/);
        const aliases = aliasMatch
            ? aliasMatch[1].replace(/<[^>]+>/g, '').replace(/,/g, ', ').trim()
            : 'N/A';

        return JSON.stringify([{ description, aliases, airdate }]);
    } catch (error) {
        console.log('extractDetails error:', error);
        return JSON.stringify([{ description: 'Error loading details.', aliases: 'N/A', airdate: 'Unknown' }]);
    }
}

async function extractEpisodes(url) {
    try {
        // Normalise URL
        const cleanUrl = url.replace(/\/watch\/?$/, '');
        const isTV = cleanUrl.includes('/tv/');

        if (!isTV) {
            // For movies there's only one "episode" — the watch page itself
            return JSON.stringify([{ href: cleanUrl + '/watch', number: '1' }]);
        }

        // Fetch the TV show page
        const response = await fetchv2(cleanUrl + '/watch', {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://redflix.co/'
        });

        const html = await response.text();
        const episodes = [];

        // Pattern 1: explicit episode links with season/episode numbers
        const epLinkRegex = /<a[^>]+href="([^"]*\/watch\?[^"]*(?:ep|episode)[^"]*)"[^>]*>[\s\S]{0,200}?(?:Episode\s*(\d+)|[Ee]p?\s*(\d+))/gi;
        let match;
        while ((match = epLinkRegex.exec(html)) !== null) {
            const href = match[1].startsWith('http') ? match[1] : 'https://redflix.co' + match[1];
            const number = match[2] || match[3];
            if (href && number) {
                episodes.push({ href, number: parseInt(number, 10) });
            }
        }

        // Pattern 2: data-* attributes style
        if (episodes.length === 0) {
            const dataEpRegex = /data-(?:episode|ep)="(\d+)"[^>]*data-(?:src|href|url)="([^"]+)"/gi;
            while ((match = dataEpRegex.exec(html)) !== null) {
                const number = match[1];
                const href = match[2].startsWith('http') ? match[2] : 'https://redflix.co' + match[2];
                episodes.push({ href, number: parseInt(number, 10) });
            }
        }

        // Pattern 3: numbered list items
        if (episodes.length === 0) {
            const listRegex = /<(?:li|div)[^>]*data-ep(?:isode)?[^>]*>[\s\S]{0,100}?(\d+)[\s\S]{0,100}?<\/(?:li|div)>/gi;
            let epNum = 1;
            while ((match = listRegex.exec(html)) !== null) {
                episodes.push({ href: cleanUrl + `/watch?season=1&episode=${epNum}`, number: epNum });
                epNum++;
            }
        }

        // Deduplicate by number and sort
        const seen = new Set();
        const unique = episodes.filter(ep => {
            const key = String(ep.number);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        unique.sort((a, b) => Number(a.number) - Number(b.number));

        if (unique.length === 0) {
            // Return a default ep 1 so something is playable
            return JSON.stringify([{ href: cleanUrl + '/watch', number: '1' }]);
        }

        return JSON.stringify(unique.map(ep => ({ href: ep.href, number: String(ep.number) })));
    } catch (error) {
        console.log('extractEpisodes error:', error);
        return JSON.stringify([{ href: url, number: '1' }]);
    }
}

async function extractStreamUrl(url) {
    try {
        const response = await fetchv2(url, {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://redflix.co/'
        });

        const html = await response.text();

        // 1. Direct HLS (.m3u8) in page source
        const hlsMatch = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/);
        if (hlsMatch) {
            console.log('Found HLS:', hlsMatch[1]);
            return hlsMatch[1];
        }

        // 2. Direct MP4 source
        const mp4Match = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)['"]/);
        if (mp4Match) {
            console.log('Found MP4:', mp4Match[1]);
            return mp4Match[1];
        }

        // 3. Embedded iframe source — follow it
        const iframeMatch = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
        if (iframeMatch) {
            const embedUrl = iframeMatch[1].replace(/&amp;/g, '&');
            console.log('Following iframe:', embedUrl);

            const embedResp = await fetchv2(embedUrl, {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Referer': 'https://redflix.co/',
                'Accept': '*/*'
            });
            const embedHtml = await embedResp.text();

            const embedHls = embedHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/);
            if (embedHls) {
                console.log('Embed HLS:', embedHls[1]);
                return embedHls[1];
            }

            const embedMp4 = embedHtml.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)['"]/);
            if (embedMp4) {
                console.log('Embed MP4:', embedMp4[1]);
                return embedMp4[1];
            }

            // Packed / obfuscated script
            const obfScript = embedHtml.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d[\s\S]*?)<\/script>/);
            if (obfScript) {
                const unpacked = unpack(obfScript[1]);
                const unpackedHls = unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/);
                if (unpackedHls) return unpackedHls[1];
                const unpackedMp4 = unpacked.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)['"]/);
                if (unpackedMp4) return unpackedMp4[1];
            }
        }

        // 4. JSON blob with "file" or "src" key
        const jsonFileMatch = html.match(/"file"\s*:\s*"(https?:\/\/[^"]+)"/);
        if (jsonFileMatch) return jsonFileMatch[1];

        const jsonSrcMatch = html.match(/"src"\s*:\s*"(https?:\/\/[^"]+)"/);
        if (jsonSrcMatch) return jsonSrcMatch[1];

        console.log('No stream URL found');
        return null;
    } catch (error) {
        console.log('extractStreamUrl error:', error);
        return null;
    }
}

// ============================================================
// DEOBFUSCATOR (p.a.c.k.e.r) — required for some embed pages
// Credit: @mnsrulz / @jcpiccodev
// ============================================================
class Unbaser {
    constructor(base) {
        this.ALPHABET = {
            62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
            95: "' !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'",
        };
        this.dictionary = {};
        this.base = base;
        if (36 < base && base < 62) {
            this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
        }
        if (2 <= base && base <= 36) {
            this.unbase = (value) => parseInt(value, base);
        } else {
            try {
                [...this.ALPHABET[base]].forEach((cipher, index) => { this.dictionary[cipher] = index; });
            } catch (er) { throw Error("Unsupported base encoding."); }
            this.unbase = this._dictunbaser;
        }
    }
    _dictunbaser(value) {
        let ret = 0;
        [...value].reverse().forEach((cipher, index) => {
            ret = ret + ((Math.pow(this.base, index)) * this.dictionary[cipher]);
        });
        return ret;
    }
}
function detect(source) { return source.replace(" ", "").startsWith("eval(function(p,a,c,k,e,"); }
function unpack(source) {
    let { payload, symtab, radix, count } = _filterargs(source);
    if (count != symtab.length) throw Error("Malformed p.a.c.k.e.r. symtab.");
    let unbase;
    try { unbase = new Unbaser(radix); } catch (e) { throw Error("Unknown p.a.c.k.e.r. encoding."); }
    function lookup(match) {
        const word = match;
        let word2 = radix == 1 ? symtab[parseInt(word)] : symtab[unbase.unbase(word)];
        return word2 || word;
    }
    source = payload.replace(/\b\w+\b/g, lookup);
    return _replacestrings(source);
    function _filterargs(source) {
        const juicers = [
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
            /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/,
        ];
        for (const juicer of juicers) {
            const args = juicer.exec(source);
            if (args) {
                let a = args;
                if (a[2] == "[]") {}
                try {
                    return { payload: a[1], symtab: a[4].split("|"), radix: parseInt(a[2]), count: parseInt(a[3]) };
                } catch (ValueError) { throw Error("Corrupted p.a.c.k.e.r. data."); }
            }
        }
        throw Error("Could not make sense of p.a.c.k.e.r data (unexpected code structure)");
    }
    function _replacestrings(source) { return source; }
}
