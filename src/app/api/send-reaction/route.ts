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

    const { waMessageId } = await sendWhatsAppReaction({
      to,
      messageId,
      emoji: emoji || '',
      accessToken,
      phoneNumberId,
    });

    if (waMessageId) {
      // Fetch the target message
      const { data: targetMsg } = await supabase
        .from('whatsapp_portal_messages')
        .select('id, reactions, metadata')
        .eq('wa_message_id', messageId)
        .maybeSingle();

      if (targetMsg) {
        const currentReactions: any[] = targetMsg.reactions || [];
        const existingMetadata = targetMsg.metadata || {};
        const sentReactionIds = existingMetadata.sent_reaction_ids || [];

        if (!sentReactionIds.includes(waMessageId)) {
          sentReactionIds.push(waMessageId);
        }

        if (emoji) {
          // Add or update reaction from "me"
          const existingIdx = currentReactions.findIndex((r: any) => r.sender === 'me');
          if (existingIdx >= 0) {
            currentReactions[existingIdx].emoji = emoji;
            currentReactions[existingIdx].wa_message_id = waMessageId;
          } else {
            currentReactions.push({ emoji, sender: 'me', wa_message_id: waMessageId });
          }
        } else {
          // Remove reaction from "me"
          const filtered = currentReactions.filter((r: any) => r.sender !== 'me');
          currentReactions.length = 0;
          currentReactions.push(...filtered);
        }

        await supabase
          .from('whatsapp_portal_messages')
          .update({
            reactions: currentReactions,
            metadata: {
              ...existingMetadata,
              sent_reaction_ids: sentReactionIds
            }
          })
          .eq('id', targetMsg.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Send reaction error:', err);
    return NextResponse.json(
      { error: err?.response?.data?.error?.message || err.message || 'Failed to send reaction' },
      { status: 500 }
    );
  }
}
