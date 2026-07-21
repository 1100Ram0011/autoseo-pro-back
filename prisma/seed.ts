import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Create a dummy user
  const user = await prisma.user.upsert({
    where: { email: 'admin@autoseo.pro' },
    update: {},
    create: {
      email: 'admin@autoseo.pro',
      name: 'Admin User',
    },
  });

  // 2. Create a dummy site
  const site = await prisma.site.create({
    data: {
      userId: user.id,
      url: 'https://example.com',
    },
  });

  // 3. Create dummy keywords
  const keywords = [
    { keyword: 'best seo tools', volume: 5400, position: 3 },
    { keyword: 'auto seo pro', volume: 1200, position: 1 },
    { keyword: 'rank tracker 2026', volume: 800, position: 12 },
    { keyword: 'local seo for plumbers', volume: 320, position: 5 },
  ];

  for (const kw of keywords) {
    await prisma.keyword.create({
      data: {
        siteId: site.id,
        ...kw,
      },
    });
  }

  // 4. Create dummy competitors
  const competitors = [
    { url: 'ahrefs.com' },
    { url: 'semrush.com' },
    { url: 'moz.com' },
  ];

  for (const comp of competitors) {
    await prisma.competitor.create({
      data: {
        siteId: site.id,
        ...comp,
      },
    });
  }

  // 5. Create dummy backlinks
  const backlinks = [
    { domain: 'techcrunch.com', url: 'https://techcrunch.com/auto-seo', targetUrl: 'https://example.com', toxicityScore: 10 },
    { domain: 'forbes.com', url: 'https://forbes.com/business-seo', targetUrl: 'https://example.com', toxicityScore: 5 },
    { domain: 'spammy-site.xyz', url: 'https://spammy-site.xyz/links', targetUrl: 'https://example.com', toxicityScore: 85 },
  ];

  for (const bl of backlinks) {
    await prisma.backlink.create({
      data: {
        siteId: site.id,
        ...bl,
      },
    });
  }

  // 6. Create dummy visitors
  for (let i = 0; i < 50; i++) {
    await prisma.visitor.create({
      data: {
        siteId: site.id,
        country: (Math.random() > 0.1 ? ['US', 'UK', 'CA', 'IN', 'AU'][Math.floor(Math.random() * 5)] : null) as string | null,
        source: (Math.random() > 0.1 ? ['Google', 'Direct', 'Twitter', 'LinkedIn'][Math.floor(Math.random() * 4)] : null) as string | null,
      },
    });
  }

  console.log('Seeding completed successfully!');
  console.log('User created:', user.email);
  console.log('Site created:', site.url);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
