/**
 * API Client for Trend Data Sources
 * Sources:
 *   1. Turkish RSS feeds (Hürriyet, NTV, Sabah, Milliyet) — no API key, free
 *   2. NewsAPI — English global tech/business/entertainment headlines
 *   3. Semrush — paid, high quality
 *   4. Redis cache — fallback
 */

const axios = require('axios');
const Redis = require('redis');
const RSSParser = require('rss-parser');

// Turkish news RSS feeds (verified working)
const TR_RSS_FEEDS = [
    { name: 'Hürriyet Ekonomi',  url: 'https://www.hurriyet.com.tr/rss/ekonomi',                      lang: 'tr' },
    { name: 'Hürriyet Anasayfa', url: 'https://www.hurriyet.com.tr/rss/anasayfa',                     lang: 'tr' },
    { name: 'NTV Ekonomi',       url: 'https://www.ntv.com.tr/ekonomi.rss',                           lang: 'tr' },
    { name: 'NTV Teknoloji',     url: 'https://www.ntv.com.tr/teknoloji.rss',                         lang: 'tr' },
    { name: 'Sabah Ekonomi',     url: 'https://www.sabah.com.tr/rss/ekonomi.xml',                     lang: 'tr' },
    { name: 'Sabah Anasayfa',    url: 'https://www.sabah.com.tr/rss/anasayfa.xml',                    lang: 'tr' },
    { name: 'Milliyet Ekonomi',  url: 'https://www.milliyet.com.tr/rss/rssnew/ekonomirss.xml',        lang: 'tr' },
];

class TrendAPIClient {
    constructor(options = {}) {
        this.apiChoice = options.apiChoice || 'newsapi'; // 'newsapi', 'semrush', 'cache'
        this.semrushKey = options.semrushKey || process.env.SEMRUSH_API_KEY;
        this.newsApiKey = options.newsApiKey || process.env.NEWS_API_KEY;
        this.country = options.country || 'tr';
        this.timeout = options.timeout || 10000;

        this.rssParser = new RSSParser({
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PromoAI/1.0)' },
        });

        // Optional: Redis cache for fallback
        this.redis = null;
        if (options.redisUrl) {
            this.redis = Redis.createClient({ url: options.redisUrl });
            this.redis.on('error', err => console.warn('[API] Redis error:', err.message));
        }
    }

    /**
     * Fetch trending topics — combines Turkish RSS + English NewsAPI, then dedupes.
     * Falls back to Semrush or Redis cache on failure.
     */
    async fetchTrends() {
        console.log('[API] Fetching trends...');

        if (this.apiChoice === 'semrush' && this.semrushKey) {
            try {
                return await this.fetchSemrushTrends();
            } catch (err) {
                console.warn(`[API] Semrush failed: ${err.message}`);
            }
        } else {
            const results = await Promise.allSettled([
                this.fetchTurkishRssTrends(),
                this.newsApiKey ? this.fetchNewsApiTrends() : Promise.resolve([]),
            ]);

            const trTrends  = results[0].status === 'fulfilled' ? results[0].value : [];
            const enTrends  = results[1].status === 'fulfilled' ? results[1].value : [];

            if (results[0].status === 'rejected') console.warn('[API] Turkish RSS failed:', results[0].reason?.message);
            if (results[1].status === 'rejected') console.warn('[API] NewsAPI failed:', results[1].reason?.message);

            const combined = this._mergeAndRank(trTrends, enTrends);

            if (combined.length > 0) {
                console.log(`[API] Combined: ${trTrends.length} TR + ${enTrends.length} EN → ${combined.length} merged trends`);

                if (this.redis) {
                    this.redis.setEx('cached_trends', 86400, JSON.stringify(combined)).catch(() => {});
                }

                return combined;
            }

            console.warn('[API] Both live sources empty, trying cache...');
        }

        // Fallback: Redis cache
        if (this.redis) {
            try {
                return await this.getCachedTrends();
            } catch (err) {
                console.warn(`[API] Cache retrieval failed: ${err.message}`);
            }
        }

        console.error('[API] All sources exhausted, returning empty');
        return [];
    }

    /**
     * Fetch and parse Turkish RSS feeds in parallel.
     * Returns trend objects derived from headline clustering.
     */
    async fetchTurkishRssTrends() {
        const feedResults = await Promise.allSettled(
            TR_RSS_FEEDS.map(feed =>
                this.rssParser.parseURL(feed.url)
                    .then(parsed => ({ name: feed.name, items: parsed.items }))
            )
        );

        const allArticles = [];
        for (let i = 0; i < feedResults.length; i++) {
            const r = feedResults[i];
            if (r.status === 'fulfilled' && r.value.items.length > 0) {
                console.log(`[API] RSS ✅ ${r.value.name}: ${r.value.items.length} items`);
                r.value.items.forEach(item => allArticles.push({ title: item.title, lang: 'tr' }));
            } else {
                console.warn(`[API] RSS ❌ ${TR_RSS_FEEDS[i].name}: ${r.reason?.message || 'no items'}`);
            }
        }

        if (allArticles.length === 0) throw new Error('Turkish RSS: no articles fetched');

        console.log(`[API] Turkish RSS: ${allArticles.length} total articles`);
        const trends = this._articlesToTrends(allArticles, 'turkish_rss');
        console.log(`[API] Turkish RSS: Derived ${trends.length} trends`);
        return trends;
    }

    /**
     * Fetch English global tech/business/entertainment from NewsAPI.
     * Good for catching global product launches (iPhone, PS5, etc.) early.
     */
    async fetchNewsApiTrends() {
        const categories = ['technology', 'business', 'entertainment'];
        const allArticles = [];

        for (const category of categories) {
            try {
                const response = await axios.get('https://newsapi.org/v2/top-headlines', {
                    params: { language: 'en', category, pageSize: 40, apiKey: this.newsApiKey },
                    timeout: this.timeout,
                });
                allArticles.push(...(response.data.articles || []).map(a => ({ title: a.title, lang: 'en' })));
            } catch (err) {
                console.warn(`[API] NewsAPI [${category}] failed: ${err.message}`);
            }
        }

        if (allArticles.length === 0) throw new Error('NewsAPI returned no articles');

        console.log(`[API] NewsAPI: ${allArticles.length} articles`);
        const trends = this._articlesToTrends(allArticles, 'newsapi');
        console.log(`[API] NewsAPI: Derived ${trends.length} trends`);
        return trends;
    }

    /**
     * Merge TR and EN trend lists. If the same keyword appears in both,
     * boost its estimated_volume (cross-language confirmation = stronger signal).
     */
    _mergeAndRank(trTrends, enTrends) {
        const map = new Map();

        for (const t of trTrends) {
            map.set(t.query, { ...t });
        }

        for (const t of enTrends) {
            if (map.has(t.query)) {
                // Cross-language match: combine volumes, raise confidence
                const existing = map.get(t.query);
                existing.estimated_volume += t.estimated_volume;
                existing.confidence = Math.min(existing.confidence + 0.1, 0.99);
                existing.source = 'turkish_rss+newsapi';
            } else {
                map.set(t.query, { ...t });
            }
        }

        return [...map.values()]
            .sort((a, b) => b.estimated_volume - a.estimated_volume)
            .slice(0, 30);
    }

    /**
     * Convert raw article list into trend objects by clustering on keyword frequency.
     * Works for both Turkish and English titles.
     */
    _articlesToTrends(articles, source = 'unknown') {
        const STOP_WORDS = new Set([
            // Turkish — bağlaçlar, edatlar, zamir
            've', 'ile', 'bir', 'bu', 'da', 'de', 'için', 'mi', 'mı', 'mu', 'mü',
            'çok', 'daha', 'olan', 'gibi', 'nasıl', 'neden', 'son', 'yeni', 'kadar',
            'oldu', 'olarak', 'ancak', 'artık', 'üzere', 'geçen', 'yıl', 'yılın',
            'diye', 'yani', 'ama', 'veya', 'hem', 'hiç', 'bile', 'zaten', 'sadece',
            'bunu', 'buna', 'bende', 'onun', 'onlar', 'bunun', 'böyle', 'şöyle',
            'çünkü', 'eğer', 'fakat', 'lakin', 'hatta', 'iken', 'aynı', 'diğer',
            // Turkish — haber kalıpları (içerik taşımaz)
            'bakan', 'açıkladı', 'açıklaması', 'dakika', 'tarifi', 'videolu',
            'haberi', 'haberde', 'haber', 'gündem', 'gelişme', 'gelişmeler',
            'olayı', 'olayda', 'olması', 'yapıldı', 'edildi', 'verildi', 'alındı',
            'başladı', 'devam', 'sürüyor', 'bekliyor', 'geliyor', 'duyurdu',
            'mahkemesi', 'mahkeme', 'karar', 'kararı', 'savcı', 'dava', 'davası',
            'milletvekili', 'toplantı', 'açıklama', 'söyledi', 'belirtti', 'ifade',
            // Turkish — eylem kalıpları (haber fiilleri, içerik taşımaz)
            'ortaya', 'çıktı', 'çıkan', 'çıkıyor', 'hayatını', 'kaybetti', 'vefat',
            'geri', 'döndü', 'dönüyor', 'dönen',
            'dikkat', 'çeken', 'çekiyor',
            'dışı', 'yasa', 'yasadışı',
            'açıklanacak', 'açıklanıyor', 'açıklandı', 'belirlenecek', 'belirtildi',
            'sonra', 'önce', 'göre', 'beri', 'itibaren',
            // Turkish — ülke ve coğrafi isimler (her haberde geçer, sinyal taşımaz)
            'türkiye', 'türk', 'türklü', 'almanya', 'alman', 'avrupa', 'avrupalı',
            'abd', 'rusya', 'çin', 'japonya', 'fransa', 'ingiltere', 'yunanistan',
            'istanbul', 'ankara', 'izmir',
            // Turkish — siyasi/hukuki (kampanya kategorileriyle ilgisiz)
            'cumhurbaşkanı', 'başbakan', 'erdoğan', 'kılıçdaroğlu',
            'sulh', 'hukuk', 'yargı', 'anayasa',
            // Turkish — unvan ve kurum (her kurumsal haberde geçer)
            'bakanı', 'bakanlığı', 'başkanlığı', 'müdürü', 'müdürlüğü',
            'genel', 'sayın', 'yönetim', 'kurul',
            // Turkish — yarım kelimeler / bağımsız anlamı olmayan
            'merkez', 'bankası', 'yapay', 'zeka', 'zaman', 'milyar', 'dolarlık',
            'büyük', 'önemli', 'dünya', 'bilim',
            // Turkish — yüksek frekans ama sinyal taşımayan kelimeler
            'yüzde', 'mesajı', 'mesaj', 'yönelik', 'geçti', 'girdi', 'etti',
            'taziye', 'ndan', 'verdi', 'ediyor', 'işte', 'küresel', 'rekor',
            'yükseldi', 'düştü', 'arttı', 'azaldı', 'dolara', 'dolar',
            // Turkish — kişi ve takım adları (kampanya kategorisiyle ilgisiz)
            'hakimliği', 'bolat', 'şimşek', 'uraloğlu', 'yılmaz', 'bayraktar',
            'fenerbahçe', 'galatasaray', 'beşiktaş', 'trabzonspor',
            // Turkish — jenerik ama sinyal taşımayan kelimeler
            'kişi', 'lideri', 'dünyanın', 'tarihçi', 'fatih', 'kacır', 'kaçır',
            'israil', 'krizi', 'sanayi',
            // English — celebrity/person names
            'miranda', 'lambert',
            // Turkish — isimler/gazeteci (bu hafta gündemdeki kişiler)
            'ilber', 'ortaylı',
            // English — function words
            'the', 'a', 'an', 'in', 'of', 'to', 'for', 'on', 'at', 'is', 'are',
            'was', 'with', 'that', 'this', 'as', 'by', 'from', 'be', 'has', 'have',
            'will', 'can', 'could', 'would', 'should', 'been', 'being', 'were', 'had',
            'does', 'did', 'over', 'into', 'after', 'about', 'when', 'what', 'which',
            'more', 'than', 'then', 'just', 'also', 'even', 'only', 'your', 'their',
            'they', 'them', 'some', 'all', 'not', 'but', 'out', 'its', 'his', 'her',
            'our', 'who', 'how', 'now', 'new', 'get', 'got', 'here', 'there', 'any',
            'may', 'back', 'time', 'says', 'said', 'year', 'years', 'still', 'much',
            // English — news meta words
            'news', 'daily', 'times', 'post', 'week', 'report', 'poll', 'today',
            'latest', 'breaking', 'review', 'update', 'watch', 'read', 'first',
            'make', 'take', 'come', 'know', 'like', 'look', 'want', 'give', 'think',
            'people', 'world', 'trump', 'says', 'amid', 'over', 'amid', 'warns',
            // English — geopolitics & media outlets (not campaign-relevant)
            'iran', 'ıran', 'war', 'wars', 'crisis', 'conflict',
            'hollywood', 'reporter', 'variety', 'deadline', 'billboard',
            // English — tech blog names and source fragments
            '9to5mac', '9to5google', 'techcrunch', 'engadget', 'gizmodo', 'theverge',
            // English — overly generic nouns & verbs
            'series', 'release', 'releases', 'claims', 'claim', 'nature', 'business',
            'prices', 'price', 'market', 'markets', 'stocks', 'stock',
            'source', 'sources', 'report', 'launch', 'launches', 'announces', 'announced',
            // English — media/blog outlet names & URL fragments
            'macrumors', 'gamesindustry', 'entertainment', 'weekly',
            // English — generic adjectives/nouns in news
            'dynamic', 'workers', 'worker', 'rating', 'ratings',
        ]);

        const keywordMap = {};

        // Known meaningful bigrams (TR + EN)
        const BIGRAM_WHITELIST = new Set([
            // TR finance
            'yapay zeka', 'merkez bankası', 'faiz oranı', 'döviz kuru', 'borsa istanbul',
            'enflasyon oranı', 'büyüme oranı', 'cari açık', 'petrol fiyatı', 'petrol fiyatları',
            // TR tech
            'mobil uygulama', 'fiber internet', 'fiber altyapı', 'elektrikli araç',
            // EN tech/products
            'artificial intelligence', 'machine learning', 'interest rate', 'electric vehicle',
            'apple iphone', 'samsung galaxy', 'playstation xbox', 'nintendo switch',
            // EN commerce
            'black friday', 'cyber monday', 'prime day', 'mega sale', 'flash sale',
            'private credit', 'credit card',
        ]);

        for (const article of articles) {
            const isTurkish = article.lang === 'tr';
            const title = (article.title || '')
                // Normalize Turkish uppercase before lowercasing
                .replace(/İ/g, 'i')
                .replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ç/g, 'ç').replace(/Ö/g, 'ö').replace(/Ü/g, 'ü')
                // Turkish dotless-I: only apply for Turkish articles (English "I" should become "i")
                .replace(/I/g, isTurkish ? 'ı' : 'i')
                .toLowerCase();
            const clean = title.replace(/[^a-z0-9çğışöü\s]/g, ' ');
            const rawTokens = clean.split(/\s+/).filter(t => t && !t.endsWith('com') && !t.endsWith('org') && !t.endsWith('net'));

            // Unigrams: Turkish articles use unigrams; English articles prefer bigrams only
            const tokens = rawTokens.filter(t =>
                t.length >= (isTurkish ? 4 : 6) &&
                !STOP_WORDS.has(t) &&
                !/^\d+$/.test(t)
            );

            // Bigrams: consecutive non-stopword pairs
            // Exclude tokens that are likely suffix-only (Turkish case suffixes like "den", "dan", "nın", "nin")
            const TR_SUFFIXES = new Set(['den', 'dan', 'nın', 'nin', 'nun', 'nün', 'nda', 'nde', 'yla', 'yle', 'deki', 'daki', 'teki', 'taki', 'geri', 'daha', 'bile', 'göre', 'önce', 'sonra', 'beri', 'itibaren', 'dolara', 'dolarlık', 'milyara', 'milyarlık']);
            const bigrams = [];
            for (let i = 0; i < rawTokens.length - 1; i++) {
                const a = rawTokens[i], b = rawTokens[i + 1];
                const bigramCandidate = `${a} ${b}`;
                // Whitelisted bigrams bypass STOP_WORDS (e.g. "merkez bankası", "yapay zeka")
                if (BIGRAM_WHITELIST.has(bigramCandidate) ||
                    (a.length >= 5 && b.length >= 5 &&
                    !STOP_WORDS.has(a) && !STOP_WORDS.has(b) &&
                    !TR_SUFFIXES.has(b) &&
                    !/^\d+$/.test(a) && !/^\d+$/.test(b))) {
                    bigrams.push(bigramCandidate);
                }
            }

            const allTerms = [...tokens, ...bigrams];

            for (const term of allTerms) {
                if (!keywordMap[term]) {
                    keywordMap[term] = { count: 0, related: new Set(), isBigram: term.includes(' ') };
                }
                keywordMap[term].count++;
                tokens.forEach(t => t !== term && keywordMap[term].related.add(t));
            }
        }

        return Object.entries(keywordMap)
            .filter(([term, v]) => {
                // Bigrams need count >= 2; unigrams need >= 2 but prefer whitelisted bigrams
                if (term.includes(' ')) return v.count >= 2 || BIGRAM_WHITELIST.has(term);
                return v.count >= 2;
            })
            .sort((a, b) => {
                // Bigrams get a 1.5x score bonus (more specific = more signal)
                const scoreA = a[1].count * (a[0].includes(' ') ? 1.5 : 1);
                const scoreB = b[1].count * (b[0].includes(' ') ? 1.5 : 1);
                return scoreB - scoreA;
            })
            .slice(0, 20)
            .map(([keyword, data]) => ({
                query: keyword,
                related_queries: [...data.related].slice(0, 5),
                trend_growth_percent: Math.min(50 + data.count * 10, 200),
                estimated_volume: data.count * 10_000,
                hours_trending: 6,
                hours_since_peak: 1,
                is_sustained: data.count >= 4,
                confidence: Math.min(0.5 + data.count * 0.08, 0.98),
                source,
                fetched_at: new Date(),
            }));
    }

    /**
     * Fetch from Semrush Trends API (paid, reliable)
     */
    async fetchSemrushTrends() {
        const response = await axios.get('https://api.semrush.com/v3/trends', {
            params: {
                key: this.semrushKey,
                country: this.country.toUpperCase(),
                limit: 50,
                display_limit: 50,
            },
            timeout: this.timeout,
        });

        const trends = response.data.trends.map(trend => ({
            query: trend.keyword,
            related_queries: trend.related_keywords || [],
            trend_growth_percent: trend.growth_percent || 0,
            estimated_volume: trend.volume || 0,
            hours_trending: Math.random() * 6 + 1,
            hours_since_peak: Math.random() * 5,
            is_sustained: trend.growth_trend === 'stable',
            confidence: trend.confidence || 0.8,
            source: 'semrush',
            fetched_at: new Date(),
        }));

        console.log(`[API] Semrush: Fetched ${trends.length} trends`);

        if (this.redis) {
            this.redis.setEx('cached_trends', 86400, JSON.stringify(trends)).catch(() => {});
        }

        return trends;
    }

    /**
     * Get cached trends from last successful fetch
     */
    async getCachedTrends() {
        if (!this.redis) return [];

        const cached = await this.redis.get('cached_trends');
        if (!cached) return [];

        const trends = JSON.parse(cached);
        console.log(`[API] Cache: Retrieved ${trends.length} cached trends`);
        trends.forEach(t => t.source = 'cache');
        return trends;
    }
}

module.exports = TrendAPIClient;
