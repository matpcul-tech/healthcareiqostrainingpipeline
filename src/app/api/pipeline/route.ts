import { NextRequest, NextResponse } from 'next/server';
import { getProcessedIds, addProcessedIds } from '@/lib/storage';
import { pushTopicToHuggingFace, HF_DATASET_REPO, HFPushResult } from '@/lib/huggingface';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TOPIC_QUERIES: Record<string, string> = {
  longevity: 'longevity[Title] OR "healthy aging"[Title] AND (clinical trial[pt] OR review[pt] OR systematic review[pt]) AND (2018:2025[pdat])',
  prevention: '"preventive medicine"[MeSH] OR "primary prevention"[MeSH] OR "early detection of cancer"[MeSH] AND (2018:2025[pdat])',
  metabolic: '"metabolic syndrome"[MeSH] OR "insulin resistance"[MeSH] OR prediabetes[Title/Abstract] AND intervention[Title/Abstract] AND (2018:2025[pdat])',
  cardiovascular: '"cardiovascular diseases/prevention and control"[MeSH] OR "coronary artery calcium"[Title] OR ApoB[Title/Abstract] AND (2018:2025[pdat])',
  cognitive: '"alzheimer disease/prevention and control"[MeSH] OR "cognitive decline"[Title] OR "dementia prevention"[Title/Abstract] AND (2018:2025[pdat])',
  sleep: '"sleep deprivation"[MeSH] OR "sleep apnea"[MeSH] OR "sleep quality"[Title/Abstract] AND (longevity OR mortality) AND (2018:2025[pdat])',
  exercise: '"cardiorespiratory fitness"[Title] OR "VO2 max"[Title/Abstract] OR "resistance training"[MeSH] AND (longevity OR mortality) AND (2018:2025[pdat])',
  nutrition: '"diet, mediterranean"[MeSH] OR "time-restricted eating"[Title] OR "intermittent fasting"[MeSH] AND (2018:2025[pdat])',
  indigenous: '"american indian or alaska native"[MeSH] OR "indigenous health"[Title/Abstract] OR "tribal health"[Title/Abstract] AND "preventive health services"[MeSH] AND (2015:2025[pdat])',
  rural: '"rural health"[MeSH] OR "medically underserved area"[MeSH] OR "health disparities"[MeSH] AND (prevention OR screening) AND (2018:2025[pdat])',
  inflammation: '"C-reactive protein"[MeSH] OR "chronic inflammation"[Title/Abstract] OR inflammaging[Title/Abstract] AND (aging OR longevity) AND (2018:2025[pdat])',
  biomarkers: '(biomarker[Title/Abstract] OR biomarkers[Title/Abstract] OR "biological markers"[MeSH] OR "biological age"[Title/Abstract] OR "epigenetic clock"[Title/Abstract] OR "GrimAge"[Title/Abstract] OR "DunedinPACE"[Title/Abstract] OR "PhenoAge"[Title/Abstract]) AND (aging OR longevity OR "healthy aging" OR mortality OR "biological age" OR "disease prediction") AND (2015:2025[pdat])',
  hormones: 'testosterone[MeSH] OR DHEA[MeSH] OR "growth hormone"[MeSH] AND (aging OR longevity) AND (2018:2025[pdat])',
  microbiome: '"gastrointestinal microbiome"[MeSH] OR "gut microbiota"[Title/Abstract] AND (longevity OR aging OR "chronic disease") AND (2018:2025[pdat])',
  telomere: 'telomere[MeSH] OR "telomere length"[Title/Abstract] AND (aging OR longevity OR "biological age") AND (2015:2025[pdat])',
  epigenetics: '"epigenomics"[MeSH] OR "epigenetic clock"[Title/Abstract] OR "biological age"[Title/Abstract] AND (2018:2025[pdat])',
  cancer_prevention: '"neoplasms/prevention and control"[MeSH] OR "cancer screening"[Title/Abstract] AND (lifestyle OR intervention) AND (2018:2025[pdat])',
  diabetes: '"diabetes mellitus, type 2/prevention and control"[MeSH] OR "diabetes prevention"[Title/Abstract] AND intervention AND (2018:2025[pdat])',
  hypertension: '"hypertension/prevention and control"[MeSH] OR "blood pressure"[MeSH] AND (lifestyle OR diet OR exercise) AND (2018:2025[pdat])',
  mental_health: '"depression/prevention and control"[MeSH] OR "adverse childhood experiences"[Title/Abstract] AND (longevity OR mortality) AND (2018:2025[pdat])',
  precision_medicine: '"precision medicine"[MeSH] OR "personalized medicine"[Title/Abstract] OR "genomic medicine"[Title/Abstract] OR "pharmacogenomics"[MeSH] AND (prevention OR longevity OR "early detection") AND (2018:2025[pdat])',
  gut_health: '"gastrointestinal microbiome"[MeSH] OR "intestinal mucosa"[MeSH] OR "leaky gut"[Title/Abstract] OR "intestinal permeability"[MeSH] OR "irritable bowel syndrome"[MeSH] AND (health OR disease OR prevention OR intervention) AND (2018:2025[pdat])',
  autoimmune: '"autoimmune diseases"[MeSH] OR "rheumatoid arthritis"[MeSH] OR "lupus erythematosus, systemic"[MeSH] OR "hashimoto disease"[MeSH] OR "multiple sclerosis"[MeSH] AND (prevention OR intervention OR lifestyle OR diet) AND (2018:2025[pdat])',
  chronic_pain: '"chronic pain"[MeSH] OR "pain management"[MeSH] OR "fibromyalgia"[MeSH] OR "musculoskeletal pain"[MeSH] AND (intervention OR lifestyle OR "non-pharmacologic" OR "mind-body") AND (2018:2025[pdat])',
  native_diabetes: '"american indian or alaska native"[MeSH] AND ("diabetes mellitus, type 2"[MeSH] OR diabetes[Title/Abstract] OR "metabolic syndrome"[MeSH]) AND (prevention OR intervention OR community OR "tribal health") AND (2015:2025[pdat])',
  tribal_mental_health: '"american indian or alaska native"[MeSH] AND ("mental health"[MeSH] OR "depression"[MeSH] OR "historical trauma"[Title/Abstract] OR "suicide prevention"[Title/Abstract] OR "substance-related disorders"[MeSH]) AND (intervention OR community OR cultural) AND (2015:2025[pdat])',
  food_sovereignty: '"food sovereignty"[Title/Abstract] OR "indigenous food"[Title/Abstract] OR "traditional foods"[Title/Abstract] OR "food security"[MeSH] OR "food deserts"[MeSH] AND (nutrition OR health OR community OR indigenous) AND (2015:2025[pdat])',
  environmental_health: '"environmental exposure"[MeSH] OR "environmental pollutants"[MeSH] OR "endocrine disruptors"[MeSH] OR "heavy metals"[Title/Abstract] OR "per- and polyfluoroalkyl substances"[Title/Abstract] AND (health OR disease OR prevention OR detoxification) AND (2018:2025[pdat])',
  epigenetics_lifestyle: '"epigenomics"[MeSH] OR "DNA methylation"[MeSH] OR "histone modification"[Title/Abstract] AND (lifestyle OR diet OR exercise OR stress OR meditation) AND (prevention OR longevity OR "gene expression") AND (2018:2025[pdat])',
  immune_optimization: '"immune system"[MeSH] OR "immunity, innate"[MeSH] OR "immunosenescence"[MeSH] OR "immunomodulation"[MeSH] AND (lifestyle OR nutrition OR exercise OR optimization OR longevity) AND (2018:2025[pdat])',
};

const TRAINING_SYSTEM = `You are the Sovereign Health LLM, a specialized longevity and early prevention AI trained on peer-reviewed medical literature. You serve rural and Indigenous communities who have historically been excluded from precision preventive medicine. You provide evidence-based, clinically accurate, culturally grounded health guidance focused on early disease detection, longevity optimization, and prevention. You cite specific studies and biomarkers. You connect science to actionable prevention. You understand rural health barriers, Indigenous health factors, social determinants of health, and intergenerational trauma as legitimate clinical variables.`;

interface Article {
  pmid: string;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SovereignHealthPipeline/1.0 (matpcul@gmail.com)' },
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) return res;
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}

async function searchPubMed(query: string, maxResults: number): Promise<string[]> {
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json&sort=relevance`;
  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    return data?.esearchresult?.idlist || [];
  } catch {
    return [];
  }
}

async function fetchAbstracts(pmids: string[]): Promise<Article[]> {
  if (!pmids.length) return [];
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=xml&rettype=abstract`;
  try {
    const res = await fetchWithRetry(url);
    const xml = await res.text();
    return parseArticles(xml);
  } catch {
    return [];
  }
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? cleanText(match[1]) : '';
}

function parseArticles(xml: string): Article[] {
  const articles: Article[] = [];
  const blocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  for (const block of blocks) {
    try {
      const pmid = extractTag(block, 'PMID');
      const title = extractTag(block, 'ArticleTitle');
      const journal = extractTag(block, 'Title') || extractTag(block, 'ISOAbbreviation');
      const year = (extractTag(block, 'Year') || extractTag(block, 'MedlineDate')).substring(0, 4);
      const doi = (() => { const m = block.match(/<ArticleId IdType="doi">(.*?)<\/ArticleId>/); return m ? m[1].trim() : ''; })();
      const abstractTexts = block.match(/<AbstractText[^>]*>[\s\S]*?<\/AbstractText>/g) || [];
      const abstract = abstractTexts.map(t => t.replace(/<[^>]+>/g, ' ').trim()).join(' ').replace(/\s+/g, ' ').trim();
      const lastNames = block.match(/<LastName>.*?<\/LastName>/g) || [];
      const authors = lastNames.slice(0, 3).map(n => n.replace(/<[^>]+>/g, '').trim()).join(', ') + (lastNames.length > 3 ? ' et al.' : '');
      if (title && abstract && abstract.length > 100) {
        articles.push({ pmid, title, abstract, authors, journal, year, doi });
      }
    } catch { continue; }
  }
  return articles;
}

const PROMPTS = [
  (t: string, a: Article) => `What does the research say about ${t} based on the study "${a.title}" published in ${a.journal}?`,
  (t: string, a: Article) => `Explain the key findings from this peer-reviewed study on ${t}: "${a.title}" by ${a.authors}.`,
  (t: string, a: Article) => `How should a rural community health center apply the findings from "${a.title}" (${a.year}) to improve ${t} outcomes?`,
  (t: string, a: Article) => `What are the clinical implications for Indigenous and underserved populations from this ${a.year} study on ${t}? Title: "${a.title}"`,
  (t: string, a: Article) => `As a patient in a rural area trying to optimize my ${t}, what does this research mean for me? Study: "${a.title}" by ${a.authors}.`,
  (t: string, _a: Article) => `What does current peer-reviewed evidence say about ${t} and how can it be applied in preventive care for underserved communities?`,
  (t: string, _a: Article) => `How does ${t} affect longevity and long-term health outcomes based on published medical research?`,
  (t: string, _a: Article) => `What actionable steps can someone in a rural Indigenous community take to address ${t} without specialist access?`,
];

function buildTrainingPairs(articles: Article[], topic: string): object[] {
  const label = topic.replace(/_/g, ' ');
  return articles.map((article, idx) => {
    const prompt = PROMPTS[idx % PROMPTS.length](label, article);
    const citation = `${article.authors}${article.authors ? '. ' : ''}"${article.title}." ${article.journal}${article.year ? `, ${article.year}` : ''}${article.doi ? `. DOI: ${article.doi}` : ''}. PMID: ${article.pmid}.`;
    const completion = `Based on peer-reviewed research, here is what this study tells us about ${label}:\n\n${article.abstract}\n\nCLINICAL IMPLICATIONS FOR PREVENTION:\nThis research is directly relevant to early prevention and longevity optimization. The findings support proactive screening and lifestyle intervention ideally 10 to 20 years before symptoms appear. For rural and Indigenous communities where specialist access is limited, this evidence supports community-based interventions deliverable through primary care, FQHC settings, and tribal health programs.\n\nEVIDENCE SOURCE:\n${citation}\n\nThis analysis is based on published peer-reviewed literature. Always discuss specific medical decisions with a qualified healthcare provider.`;
    return {
      id: `pubmed-${article.pmid}-${topic}-${idx}`,
      source: 'pubmed-sovereign-health-pipeline-v2',
      topic,
      timestamp: new Date().toISOString(),
      messages: [
        { role: 'system', content: TRAINING_SYSTEM },
        { role: 'user', content: prompt },
        { role: 'assistant', content: completion },
      ],
      metadata: { pmid: article.pmid, doi: article.doi, title: article.title, authors: article.authors, journal: article.journal, year: article.year },
    };
  });
}

interface DedupeStats {
  fetched: number;
  alreadyProcessed: number;
  newCandidates: number;
  newlyMarked: number;
}

export async function POST(req: NextRequest) {
  try {
    let body: { topics?: unknown; maxPerTopic?: unknown };
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const topics = body.topics;
    const maxPerTopic = typeof body.maxPerTopic === 'number' ? Math.min(Math.max(body.maxPerTopic, 5), 100) : 20;

    if (!Array.isArray(topics) || topics.length === 0) {
      return NextResponse.json({ error: 'topics must be a non-empty array' }, { status: 400 });
    }

    const allPairs: object[] = [];
    const results: Record<string, number> = {};
    const errors: string[] = [];
    const huggingFace: Record<string, HFPushResult> = {};
    const dedupe: Record<string, DedupeStats> = {};

    for (const topic of topics) {
      if (typeof topic !== 'string') {
        errors.push(`Invalid topic: ${JSON.stringify(topic)}`);
        continue;
      }
      const query = TOPIC_QUERIES[topic];
      if (!query) {
        errors.push(`Unknown topic: ${topic}`);
        results[topic] = 0;
        continue;
      }
      try {
        const pmids = await searchPubMed(query, maxPerTopic);
        const stats: DedupeStats = {
          fetched: pmids.length,
          alreadyProcessed: 0,
          newCandidates: pmids.length,
          newlyMarked: 0,
        };
        if (!pmids.length) {
          results[topic] = 0;
          dedupe[topic] = stats;
          continue;
        }

        let newPmids = pmids;
        try {
          const processed = await getProcessedIds(topic);
          if (processed.ids.size > 0) {
            newPmids = pmids.filter(id => !processed.ids.has(String(id)));
            stats.alreadyProcessed = pmids.length - newPmids.length;
            stats.newCandidates = newPmids.length;
          }
        } catch (err) {
          errors.push(`Dedupe lookup failed for ${topic}: ${String(err)}`);
        }

        if (newPmids.length === 0) {
          results[topic] = 0;
          dedupe[topic] = stats;
          continue;
        }

        const articles: Article[] = [];
        for (let i = 0; i < Math.min(newPmids.length, maxPerTopic); i += 20) {
          const batch = newPmids.slice(i, i + 20);
          const batchArticles = await fetchAbstracts(batch);
          articles.push(...batchArticles);
          await new Promise(r => setTimeout(r, 400));
        }
        const pairs = buildTrainingPairs(articles, topic);
        results[topic] = pairs.length;
        allPairs.push(...pairs);

        if (pairs.length === 0) {
          dedupe[topic] = stats;
          continue;
        }

        const topicJsonl = pairs.map(p => JSON.stringify(p)).join('\n');

        try {
          const processedIds = articles.map(a => a.pmid).filter(Boolean);
          if (processedIds.length > 0) {
            const marked = await addProcessedIds(topic, processedIds);
            stats.newlyMarked = marked.added;
          }
        } catch (err) {
          errors.push(`Dedupe write failed for ${topic}: ${String(err)}`);
        }

        try {
          const hf = await pushTopicToHuggingFace(topic, topicJsonl, pairs.length);
          huggingFace[topic] = hf;
          if (!hf.pushed && hf.reason) {
            errors.push(`HF push skipped for ${topic}: ${hf.reason}`);
          }
        } catch (err) {
          const reason = String(err);
          huggingFace[topic] = { pushed: false, reason, repo: HF_DATASET_REPO };
          errors.push(`HF push failed for ${topic}: ${reason}`);
        }

        dedupe[topic] = stats;
      } catch (err) {
        errors.push(`Failed ${topic}: ${String(err)}`);
        results[topic] = results[topic] ?? 0;
      }
    }

    const jsonl = allPairs.map(p => JSON.stringify(p)).join('\n');

    return NextResponse.json({
      success: true,
      totalPairs: allPairs.length,
      byTopic: results,
      huggingFace,
      huggingFaceRepo: HF_DATASET_REPO,
      dedupe,
      errors,
      jsonl,
      downloadReady: true,
    });

  } catch (err) {
    console.error('Pipeline error:', err);
    return NextResponse.json({ error: `Pipeline error: ${String(err)}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'Sovereign Health Pipeline active',
    runtime: 'nodejs',
    maxDuration: 300,
    availableTopics: Object.keys(TOPIC_QUERIES),
    topicCount: Object.keys(TOPIC_QUERIES).length,
    huggingFaceRepo: HF_DATASET_REPO,
    storage: 'In-memory dedupe via processed-ids during a run; Hugging Face dataset push after each topic is the only persistent storage.',
    description: 'POST with { topics: string[], maxPerTopic: number } to fetch PubMed abstracts and generate Llama training pairs.',
    example: { topics: ['longevity', 'indigenous', 'metabolic'], maxPerTopic: 20 },
  });
}
