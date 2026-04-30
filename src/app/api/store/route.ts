import { NextRequest, NextResponse } from 'next/server';
import { appendTopicPairs, getCount, getMaster } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jsonl, runTotal, topic } = body;
    if (typeof jsonl !== 'string') {
      return NextResponse.json({ error: 'jsonl required' }, { status: 400 });
    }
    if (typeof topic !== 'string' || !topic.trim()) {
      return NextResponse.json({ error: 'topic required' }, { status: 400 });
    }
    const added = typeof runTotal === 'number' && runTotal > 0 ? runTotal : 0;
    const { kvAvailable, masterTotal, topicTotal, topicKey } = await appendTopicPairs(
      topic,
      jsonl,
      added,
    );
    return NextResponse.json({
      success: true,
      savedPairs: added,
      topic,
      topicKey,
      topicTotal,
      masterTotal,
      kvAvailable,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const wantCount = url.searchParams.get('count') === 'true';
    if (wantCount) {
      const { total, byTopic, kvAvailable } = await getCount();
      return NextResponse.json({ total, byTopic, kvAvailable });
    }
    const { jsonl, total, byTopic, topicCount, kvAvailable } = await getMaster();
    if (!kvAvailable) {
      return NextResponse.json({ error: 'KV not configured', total: 0 }, { status: 503 });
    }
    if (!jsonl) {
      return NextResponse.json({ error: 'No data yet', total: 0, byTopic, topicCount });
    }
    return new NextResponse(jsonl, {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="sovereign-health-master-${total}-pairs.jsonl"`,
        'X-Total-Pairs': String(total),
        'X-Topic-Count': String(topicCount),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
