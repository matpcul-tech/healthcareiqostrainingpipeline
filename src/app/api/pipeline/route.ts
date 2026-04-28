import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 60;

// ── SEARCH TOPICS ─────────────────────────────────────────────────────────────
// Each topic maps to a precise PubMed search query targeting the best evidence
const TOPIC_QUERIES: Record<string, string> = {
  longevity: 'longevity[Title] OR "healthy aging"[Title] OR "lifespan extension"[Title] AND (humans[Filter]) AND (clinical trial[pt] OR review[pt] OR systematic review[pt])',
  prevention: '"preventive medicine"[MeSH] OR "early detection of cancer"[MeSH] OR "primary prevention"[MeSH] AND (2018:2025[pdat])',
  metabolic: '"metabolic syndrome"[MeSH] OR "insulin resistance"[MeSH] OR "prediabetes"[Title/Abstract] AND (intervention[Title/Abstract]) AND (2018:2025[pdat])',
  cardiovascular: '"cardiovascular diseases/prevention and control"[MeSH] OR "coronary artery calcium"[Title] OR "ApoB"[Title/Abstract] AND (2018:2025[pdat])',
  cognitive: '"alzheimer disease/prevention and control"[MeSH] OR "cognitive decline"[Title] OR "dementia prevention"[Title/Abstract] AND (2018:2025[pdat])',
  sleep: '"sleep/physiology"[MeSH] OR "sleep deprivation"[MeSH] OR "sleep apnea"[MeSH] AND (longevity OR mortality OR health outcomes) AND (2018:2025[pdat])',
  exercise: '"exercise/physiology"[MeSH] OR "cardiorespiratory fitness"[Title] OR "VO2 max"[Title/Abstract] OR "resistance training"[MeSH] AND (longevity OR mortality) AND (2018:2025[pdat])',
  nutrition: '"diet, mediterranean"[MeSH] OR "fasting"[MeSH] OR "time-restricted eating"[Title] OR "longevity diet"[Title/Abstract] AND (2018:2025[pdat])',
  indigenous: '"american indian or alaska native"[MeSH] OR "indigenous health"[Title/Abstract] OR "tribal health"[Title/Abstract] OR "health disparities"[MeSH] AND ("preventive health services"[MeSH]) AND (2015:2025[pdat])',
  rural: '"rural health"[MeSH] OR "rural health services"[MeSH] OR "medically underserved area"[MeSH] AND (prevention OR screening OR "chronic disease") AND (2018:2025[pdat])',
  inflammation: '"inflammation"[MeSH] OR "C-reactive protein"[MeSH] OR "chronic inflammation"[Title/Abstract] AND (aging OR longevity OR mortality) AND (2018:2025[pdat])',
  biomarkers: '"biological markers"[MeSH] AND (longevity OR "healthy aging" OR "disease risk") AND (2018:2025[pdat])',
  hormones: '"testosterone"[MeSH] OR "DHEA"[MeSH] OR "growth hormone"[MeSH] AND (aging OR longevity) AND (2018:2025[pdat])',
  microbiome: '"gastrointestinal microbiome"[MeSH] OR "gut microbiota"[Title/Abstract] AND (longevity OR aging OR "chronic disease") AND (2018:2025[pdat])',
  telomere: '"telomere"[MeSH] OR "telomere length"[Title/Abstract] AND (aging OR longevity OR "biological age") AND (2015:2025[pdat])',
  epigenetics: '"epigenomics"[MeSH] OR "epigenetic clock"[Title/Abstract] OR "biological age"[Title/Abstract] AND (2018:2025[pdat])',
  cancer_prevention: '"neoplasms/prevention and control"[MeSH] OR "cancer screening"[Title/Abstract] OR "cancer prevention"[Title/Abstract] AND (2018:2025[pdat])',
  diabetes: '"diabetes mellitus, type 2/prevention and control"[MeSH] OR "diabetes prevention"[Title/Abstract] OR "A1C"[Title/Abstract] AND (intervention) AND (2018:2025[pdat])',
  hypertension: '"hypertension/prevention and control"[MeSH] OR "blood pressure"[MeSH] AND (lifestyle OR diet OR exercise) AND (2018:2025[pdat])',
  mental_health: '"mental health"[MeSH] OR "depression/prevention and control"[MeSH] OR "adverse childhood experiences"[Title/Abstract] AND (longevity OR mortality OR "chronic disease") AND (2018:2025[pdat])',
};

// ── SYSTEM PROMPT FOR TRAINING PAIRS ─────────────────────────────────────────
const TRAINING_SYSTEM = `You are the Sovereign Health LLM, a specialized longevity and early prevention AI trained on peer-reviewed medical literature. You serve rural and Indigenous communities who have historically been excluded from precision preventive medicine. You provide evidence-based, clinically accurate, culturally grounded health guidance focused on early disease detection, longevity optimization, and prevention. You cite specific studies and biomarkers. You connect science to actionable prevention. You understand rural health barriers, Indigenous health factors, social determinants of health, and intergenerational trauma as legitimate clinical variables.`;

// ── PUBMED API FUNCTIONS ──────────────────────────────────────────────────────
async function searchPubMed(query: string, maxResults: number = 50): Promise<string[]> {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const searchUrl = `${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json&sort=relevance`;

  const res = await fetch(searchUrl);
  const data = await res.json();
  return data?.esearchresult?.idlist || [];
}

async function fetchAbstracts(pmids: string[]): Promise<Article[]> {
  if (!pmids.length) return [];
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const ids = pmids.slice(0, 20).join(','); // batch of 20
  const fetchUrl = `${base}/efetch.fcgi?db=pubmed&id=${ids}&retmode=xml&rettype=abstract`;

  const res = await fetch(fetchUrl);
  const xml = await res.text();

  return parseArticles(xml);
}

interface Article {
  pmid: string;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
}

function parseArticles(xml: string): Article[] {
  const articles: Article[] = [];

  // Simple XML parsing without external libraries
  const articleBlocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];

  for (const block of articleBlocks) {
    const pmid = extractTag(block, 'PMID') || '';
    const title = extractTag(block, 'ArticleTitle') || '';
    const journal = extractTag(block, 'Title') || extractTag(block, 'ISOAbbreviation') || '';
    const year = extractTag(block, 'Year') || extractTag(block, 'MedlineDate') || '';
    const doi = extractDOI(block);

    // Extract abstract text (may have multiple AbstractText sections)
    const abstractTexts = block.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
    const abstract = abstractTexts
      .map(t => t.replace(/<[^>]+>/g, ' ').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract authors
    const lastNames = block.match(/<LastName>(.*?)<\/LastName>/g) || [];
    const authors = lastNames
      .slice(0, 3)
      .map(n => n.replace(/<[^>]+>/g, ''))
      .join(', ') + (lastNames.length > 3 ? ' et al.' : '');

    if (title && abstract && abstract.length > 100) {
      articles.push({ pmid, title: cleanText(title), abstract: cleanText(abstract), authors, journal: cleanText(journal), year: year.substring(0, 4), doi });
    }
  }

  return articles;
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? cleanText(match[1]) : '';
}

function extractDOI(xml: string): string {
  const match = xml.match(/<ArticleId IdType="doi">(.*?)<\/ArticleId>/);
  return match ? match[1] : '';
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── BUILD TRAINING PAIRS ──────────────────────────────────────────────────────
function buildTrainingPairs(articles: Article[], topic: string): object[] {
  return articles.map(article => {
    const prompt = buildPrompt(article, topic);
    const completion = buildCompletion(article, topic);

    return {
      source: 'pubmed',
      pmid: article.pmid,
      doi: article.doi,
      topic,
      timestamp: new Date().toISOString(),
      messages: [
        { role: 'system', content: TRAINING_SYSTEM },
        { role: 'user', content: prompt },
        { role: 'assistant', content: completion },
      ],
      metadata: {
        title: article.title,
        authors: article.authors,
        journal: article.journal,
        year: article.year,
        abstractLength: article.abstract.length,
      },
    };
  });
}

function buildPrompt(article: Article, topic: string): string {
  const topicLabel = topic.replace(/_/g, ' ');
  const prompts = [
    `What does the research say about ${topicLabel} based on this study: "${article.title}" published in ${article.journal}?`,
    `Explain the key findings from this peer-reviewed research on ${topicLabel}: "${article.title}"`,
    `How should I apply this research on ${topicLabel} to my preventive health practice? Study: "${article.title}" by ${article.authors}.`,
    `What are the clinical implications of this ${article.year} study on ${topicLabel}? "${article.title}"`,
    `As a patient trying to optimize my ${topicLabel}, what does this research mean for me? Study: "${article.title}"`,
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

function buildCompletion(article: Article, topic: string): string {
  const citation = `${article.authors}${article.authors ? '. ' : ''}"${article.title}." ${article.journal}${article.year ? `, ${article.year}` : ''}${article.doi ? `. DOI: ${article.doi}` : ''}. PMID: ${article.pmid}.`;

  return `Based on peer-reviewed research, here is what this study tells us about ${topic.replace(/_/g, ' ')}:

${article.abstract}

CLINICAL IMPLICATIONS FOR PREVENTION:
This research is particularly relevant for early prevention and longevity optimization because it provides evidence-based guidance on ${topic.replace(/_/g, ' ')}. The findings suggest that screening, lifestyle modification, and targeted intervention can meaningfully reduce disease risk when applied proactively — ideally 10 to 20 years before symptoms would otherwise appear.

For rural and Indigenous communities, where access to specialist care is often limited, this research supports the case for community-based preventive interventions that can be delivered through primary care, FQHC settings, and tribal health programs without requiring specialty referral.

EVIDENCE SOURCE:
${citation}

This analysis is based on published peer-reviewed literature. Always discuss specific medical decisions with a qualified healthcare provider familiar with your complete health history.`;
}

// ── API HANDLER ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topics, maxPerTopic = 20 } = body;

    if (!topics || !Array.isArray(topics) || topics.length === 0) {
      return NextResponse.json({ error: 'No topics provided' }, { status: 400 });
    }

    const allPairs: object[] = [];
    const results: Record<string, number> = {};
    const errors: string[] = [];

    for (const topic of topics) {
      try {
        const query = TOPIC_QUERIES[topic];
        if (!query) { errors.push(`Unknown topic: ${topic}`); continue; }

        // Search PubMed
        const pmids = await searchPubMed(query, maxPerTopic);
        if (!pmids.length) { results[topic] = 0; continue; }

        // Fetch abstracts in batches
        const batchSize = 20;
        const articles: Article[] = [];
        for (let i = 0; i < Math.min(pmids.length, maxPerTopic); i += batchSize) {
          const batch = pmids.slice(i, i + batchSize);
          const batchArticles = await fetchAbstracts(batch);
          articles.push(...batchArticles);
          // Rate limit respect — 3 requests per second max for NCBI
          await new Promise(r => setTimeout(r, 350));
        }

        // Build training pairs
        const pairs = buildTrainingPairs(articles, topic);
        allPairs.push(...pairs);
        results[topic] = pairs.length;

      } catch (err) {
        errors.push(`Error on topic ${topic}: ${String(err)}`);
        results[topic] = 0;
      }
    }

    // Return JSONL as download
    const jsonl = allPairs.map(p => JSON.stringify(p)).join('\n');

    return NextResponse.json({
      success: true,
      totalPairs: allPairs.length,
      byTopic: results,
      errors,
      jsonl,
      downloadReady: true,
    });

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'Sovereign Health Pipeline active',
    availableTopics: Object.keys(TOPIC_QUERIES),
    description: 'POST with { topics: string[], maxPerTopic: number } to fetch PubMed data and generate Llama training pairs.',
  });
}
