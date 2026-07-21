/**
 * Mock Data Utility
 * Centralized mock data generation for when APIs are not connected.
 * All mock data generators live here instead of being scattered across services.
 */

// --- Environment Check ---
export const isMockMode = (): boolean => {
  return !process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY';
};

export const isGoogleConnected = (refreshToken: string | null | undefined): boolean => {
  return !!refreshToken;
};

// --- GSC Mock Data ---
export const MOCK_GSC = {
  overview: {
    metrics: {
      clicks: 12540, clicksChange: 18.6,
      impressions: 1250000, impressionsChange: 15.3,
      ctr: 1.0, ctrChange: 2.7,
      position: 18.7, positionChange: -4.3,
      indexed: 1324, indexedChange: 35,
      notIndexed: 154, notIndexedChange: -12
    },
    trend: Array.from({ length: 30 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return {
        date: d.toISOString().split('T')[0],
        clicks: Math.floor(Math.random() * 500) + 150,
        impressions: Math.floor(Math.random() * 15000) + 5000
      };
    })
  },
  keywords: {
    keywords: [
      { keyword: 'background verification', clicks: 1245, impressions: 8500, ctr: 14.6, position: 2.3 },
      { keyword: 'background check', clicks: 934, impressions: 9100, ctr: 10.2, position: 4.1 },
      { keyword: 'employee verification', clicks: 643, impressions: 5200, ctr: 12.3, position: 3.2 },
      { keyword: 'address check', clicks: 432, impressions: 15400, ctr: 2.8, position: 11.5 },
      { keyword: 'criminal record check', clicks: 321, impressions: 4100, ctr: 7.8, position: 5.6 },
      { keyword: 'tenant screening', clicks: 112, impressions: 9800, ctr: 1.1, position: 14.2 },
      { keyword: 'identity verification api', clicks: 85, impressions: 21000, ctr: 0.4, position: 8.5 },
      { keyword: 'best background check service', clicks: 42, impressions: 3200, ctr: 1.3, position: 18.1 },
    ]
  },
  pages: {
    pages: [
      { page: '/', clicks: 3245, impressions: 245123, ctr: 1.32, position: 12.4 },
      { page: '/blog', clicks: 2341, impressions: 210456, ctr: 1.11, position: 16.7 },
      { page: '/services/bg-check', clicks: 1876, impressions: 154321, ctr: 1.21, position: 8.9 },
      { page: '/about', clicks: 943, impressions: 87654, ctr: 1.07, position: 21.3 },
      { page: '/contact', clicks: 832, impressions: 45678, ctr: 1.82, position: 5.4 },
    ]
  },
  coverage: {
    indexed: 1324,
    submitted: 1540,
    crawledNotIndexed: 120,
    discoveredNotIndexed: 34,
    excluded: 54
  },
  devices: {
    devices: [
      { device: 'MOBILE', clicks: 5430, impressions: 85200 },
      { device: 'DESKTOP', clicks: 3210, impressions: 45100 },
      { device: 'TABLET', clicks: 420, impressions: 6300 },
    ]
  }
};

// --- GA4 Mock Data ---
export const MOCK_GA4 = {
  overview: {
    metrics: { activeUsers: 0, activeUsersChange: 0 },
    trend: []
  }
};

// --- PageSpeed Mock Data ---
export const generateMockPageSpeed = (url: string, strategy: 'mobile' | 'desktop') => ({
  strategy,
  url,
  fetchTime: new Date().toISOString(),
  scores: {
    performance: strategy === 'mobile' ? 68 : 92,
    accessibility: 85,
    bestPractices: 100,
    seo: 92
  },
  coreWebVitals: {
    lab: {
      lcp: { value: strategy === 'mobile' ? 2800 : 1200, displayValue: strategy === 'mobile' ? '2.8 s' : '1.2 s', rating: strategy === 'mobile' ? 'needs-improvement' : 'good' },
      fcp: { value: 1100, displayValue: '1.1 s', rating: 'good' },
      cls: { value: 0.05, displayValue: '0.05', rating: 'good' },
      tbt: { value: 150, displayValue: '150 ms' },
      speedIndex: { value: 2100, displayValue: '2.1 s' },
      ttfb: { value: 200, displayValue: '200 ms', rating: 'good' }
    },
    field: null,
    originField: null
  },
  opportunities: [
    {
      id: 'unused-javascript',
      title: 'Reduce unused JavaScript',
      description: 'Reduce unused JavaScript and defer loading scripts until they are required.',
      wastedBytes: 150000,
      wastedMs: 450,
      items: [{ url: `${url}/bundle.js`, totalBytes: 250000, wastedBytes: 150000 }]
    }
  ],
  diagnostics: {
    domSize: { value: 850, details: [] },
    mainThread: [],
    networkRequests: [],
    networkRtt: 50,
    thirdParty: [],
    longTasks: [],
    resourceSummary: []
  },
  audits: { seo: [], accessibility: [], bestPractices: [] },
  screenshots: { final: null, filmstrip: [] }
});

// --- AI Mock Data ---
export const MOCK_AI = {
  analysis: (siteUrl: string) => ({
    overallHealthScore: 78,
    summary: `Based on the provided data for ${siteUrl || 'your site'}, the overall SEO and performance are moderate. There are some critical technical issues blocking optimal indexing, and the core web vitals need improvement, especially regarding mobile load times.`,
    keyFindings: [
      { title: "Traffic is Stable", description: "You have maintained steady visitor numbers this week with slight positive growth." },
      { title: "High Number of Unindexed Pages", description: "A significant portion of your pages are not indexed by Google, which means they are not receiving organic traffic." },
      { title: "Performance Issues", description: "PageSpeed Insights shows a low score, largely due to unoptimized images and render-blocking scripts." }
    ],
    actionPlan: [
      { task: "Compress all hero images on the homepage", priority: "High", impact: "Improves LCP and PageSpeed score significantly." },
      { task: "Check Google Search Console for coverage errors", priority: "High", impact: "Fixes the high number of unindexed pages." },
      { task: "Publish new content targeting long-tail keywords", priority: "Medium", impact: "Capitalizes on stable traffic to drive more targeted users." }
    ]
  }),

  keywords: (topic: string) => ([
    { keyword: `best ${topic}`, volume: 12000, difficulty: 'Medium' },
    { keyword: `${topic} tools`, volume: 5400, difficulty: 'Low' },
    { keyword: `how to use ${topic}`, volume: 8900, difficulty: 'High' },
    { keyword: `free ${topic} software`, volume: 3200, difficulty: 'Low' },
  ]),

  blogPost: (keyword: string) => (
    `# The Ultimate Guide to ${keyword}\n\nThis is a mock blog post generated because a valid Gemini API key was not found in the \`.env\` file.\n\n## Why is ${keyword} important?\nIt helps with SEO and engaging your audience.\n\n## Top 3 Tips\n1. Be consistent.\n2. Write for humans, optimize for bots.\n3. Keep paragraphs short.\n\n> This is a blockquote about the topic.\n\nHappy ranking!`
  ),

  schema: (topic: string) => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [{
      "@type": "Question",
      "name": `What is ${topic}?`,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": `This is a mock schema for ${topic}.`
      }
    }]
  }),

  anomalies: [
    {
      type: "SPEED_AND_TRAFFIC_DROP",
      description: "Traffic dropped by 18% this week. We detected a correlation with a sharp drop in your Core Web Vitals (Performance score dropped to 45). Users are likely bouncing due to slow loads.",
      severity: "Critical",
      actions: [
        { task: "Minify CSS and defer render-blocking JavaScript", impact: "High - Recovers page speed and bounce rate" },
        { task: "Compress hero images on the homepage", impact: "Medium - Improves LCP score" }
      ]
    },
    {
      type: "INDEXING_FAILURE",
      description: "2 critical pages were de-indexed from Google Search Console yesterday.",
      severity: "High",
      actions: [
        { task: "Run Google Indexing API ping for affected URLs", impact: "High - Restores lost traffic instantly" },
        { task: "Check robots.txt for accidental disallow rules", impact: "Critical - Prevents further de-indexing" }
      ]
    }
  ]
};

// --- Clarity Mock Data ---
export const generateMockClarityData = (siteUrl: string) => {
  const pages = ['/', '/about', '/products', '/contact', '/blog/guide'];
  const devices = ['Mobile', 'Desktop'];
  const data: any[] = [];
  
  for (const p of pages) {
    for (const d of devices) {
      data.push({
        url: p,
        device: d,
        sessions: Math.floor(Math.random() * 500) + 50,
        rageClicks: Math.floor(Math.random() * (p === '/products' ? 20 : 5)),
        deadClicks: Math.floor(Math.random() * (p === '/contact' ? 15 : 3)),
        quickbacks: Math.floor(Math.random() * 30),
        engagementTime: Math.random() * 120 + 30
      });
    }
  }
  return data;
};
