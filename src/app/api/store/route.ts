import { NextRequest, NextResponse } from 'next/server';
import { appendPairs, getCount, getMaster } from '@/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jsonl, runTotal } = body;
    if (typeof jsonl !== 'string') {
      return NextResponse.json({ error: 'jsonl required' }, { status: 400 });
    }
    const added = typeof runTotal === 'number' && runTotal > 0 ? runTotal : 0;
    const { kvAvailable, masterTotal } = await appendPairs(jsonl, added);
    return NextResponse.json({
      success: true,
      savedPairs: added,
      masterTotal,
      kvAvailable,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const wantCount = new URL(req.url).searchParams.get('count') === 'true';
    if (wantCount) {
      const { total, kvAvailable } = await getCount();
      return NextResponse.json({ total, kvAvailable });
    }
    const { jsonl, total, kvAvailable } = await getMaster();
    if (!kvAvailable) {
      return NextResponse.json({ error: 'KV not configured', total: 0 }, { status: 503 });
    }
    if (!jsonl) {
      return NextResponse.json({ error: 'No data yet', total: 0 });
    }
    return new NextResponse(jsonl, {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="sovereign-health-master-${total}-pairs.jsonl"`,
        'X-Total-Pairs': String(total),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
