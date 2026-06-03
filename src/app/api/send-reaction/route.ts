import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendWhatsAppReaction } from '@/lib/whatsapp';

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    const { to, messageId, emoji } = await request.json();

    if (!to || !messageId) {
      return NextResponse.json(
        { error: 'Missing "to" or "messageId"' },
        { status: 400 }
      );
    }

    // Resolve credentials + real user_id from whatsapp_portal_configs
    const { data: config } = await supabase
      .from('whatsapp_portal_configs')
      .select('user_id, access_token, phone_number_id')
      .eq('phone_number_id', process.env.WHATSAPP_PHONE_NUMBER_ID!)
      .single();

    const accessToken = config?.access_token || process.env.WHATSAPP_TOKEN;
    const phoneNumberId = config?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      return NextResponse.json(
        { error: 'WhatsApp credentials are not configured.' },
        { status: 400 }
      );
    }

    await sendWhatsAppReaction({
      to,
      messageId,
      emoji: emoji || '',
      accessToken,
      phoneNumberId,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Send reaction error:', err);
    return NextResponse.json(
      { error: err?.response?.data?.error?.message || err.message || 'Failed to send reaction' },
      { status: 500 }
    );
  }
}
