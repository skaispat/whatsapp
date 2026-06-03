import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendWhatsAppTemplate, resolveTemplateFinalText } from '@/lib/whatsapp';

export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    const body = await request.json();
    const { to, templateName, languageCode, components, exactText, conversationId } = body;

    if (!to || !templateName) {
      return NextResponse.json(
        { error: 'Missing "to" or "templateName" field' },
        { status: 400 }
      );
    }

    // Resolve credentials + real user_id from whatsapp_portal_configs
    const { data: config } = await supabase
      .from('whatsapp_portal_configs')
      .select('user_id, access_token, phone_number_id, waba_id')
      .eq('phone_number_id', process.env.WHATSAPP_PHONE_NUMBER_ID!)
      .single();

    const accessToken = config?.access_token || process.env.WHATSAPP_TOKEN;
    const phoneNumberId = config?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const wabaId = config?.waba_id || process.env.WHATSAPP_WABA_ID;
    const userId = config?.user_id;

    if (!accessToken || !phoneNumberId || !userId) {
      return NextResponse.json(
        { error: 'WhatsApp credentials are not configured.' },
        { status: 400 }
      );
    }

    // Send via Meta API
    const { messageId: waMessageId } = await sendWhatsAppTemplate({
      to,
      templateName,
      languageCode: languageCode || 'en',
      components: components || [],
      accessToken,
      phoneNumberId,
    });

    console.log('📤 Template sent, waMessageId:', waMessageId);

    // Resolve the actual final text the user received
    // Priority: 1) exactText provided by caller, 2) auto-resolve from Meta template + params
    let finalContent = exactText;
    if (!finalContent && wabaId) {
      console.log('📋 Auto-resolving template text from Meta API...');
      finalContent = await resolveTemplateFinalText({
        wabaId,
        accessToken,
        templateName,
        languageCode: languageCode || 'en',
        components: components || [],
      });
      console.log(`📋 Resolved: "${finalContent?.substring(0, 100)}..."`);
    }
    if (!finalContent) {
      finalContent = `[Template: ${templateName}]`;
    }

    let currentConversationId = conversationId;

    // If conversationId is not provided (e.g. sending template to a new user), create/get it
    if (!currentConversationId) {
      // 1. Upsert contact
      const { data: contact } = await (supabase as any)
        .from('whatsapp_portal_contacts')
        .upsert(
          { user_id: userId, phone_number: to },
          { onConflict: 'user_id,phone_number' }
        )
        .select('id')
        .single();

      if (contact) {
        // 2. Upsert conversation
        const { data: conversation } = await (supabase as any)
          .from('whatsapp_portal_conversations')
          .upsert(
            {
              user_id: userId,
              contact_id: contact.id,
              last_message: finalContent,
              last_message_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,contact_id' }
          )
          .select('id')
          .single();

        if (conversation) {
          currentConversationId = conversation.id;
        }
      }
    }

    // Save outbound message to Supabase
    // Use UPSERT on wa_message_id to handle race condition with Webhook incoming statuses
    const { data: savedMsg, error: msgError } = await supabase
      .from('whatsapp_portal_messages')
      .upsert({
        user_id: userId,
        conversation_id: currentConversationId,
        wa_message_id: waMessageId,
        direction: 'outbound',
        content: finalContent,
        message_type: 'template',
        template_name: templateName,
        metadata: {
          templateName,
          components: components || [],
          languageCode: languageCode || 'en'
        }
      }, { onConflict: 'wa_message_id' })
      .select('id')
      .single();

    if (msgError) {
      console.error('Failed to save template message:', msgError);
    }

    // Update conversation if we had an existing one
    if (conversationId) {
      await supabase
        .from('whatsapp_portal_conversations')
        .update({
          last_message: finalContent,
          last_message_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .eq('user_id', userId);
    }

    return NextResponse.json({
      success: true,
      messageId: savedMsg?.id,
      waMessageId,
      resolvedText: finalContent,
    });
  } catch (err: any) {
    console.error('Send template error:', err);
    return NextResponse.json(
      { error: err?.response?.data?.error?.message || err.message || 'Failed to send template' },
      { status: 500 }
    );
  }
}
