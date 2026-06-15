import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("🚨 RAW INCOMING PAYLOAD FROM SHEET:", JSON.stringify(body, null, 2));
    
    let { user_id, wamid, phone, template_name, parameters, media_url } = body;
    const resolvedMediaUrl = media_url || "";

    // Normalize phone number to prevent duplicate contacts
    if (phone) {
      phone = phone.toString().replace(/\D/g, '');
      if (phone.length === 10) phone = `91${phone}`;
    }

    if (!user_id || !wamid || !phone || !template_name) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 1. FUZZY MATCH TEMPLATE NAME: Handle missing underscores or casing variants
    const targetNormalized = template_name.toLowerCase().replace(/_/g, '').trim();
    
    const { data: allTemplates, error: fetchError } = await supabase
      .from('whatsapp_portal_templates')
      .select('template_name, body, header, footer, buttons')
      .eq('user_id', user_id);

    if (fetchError) console.error('Error fetching template list:', fetchError);

    console.log("🔍 MATCHING TEMPLATES DEBUG:", {
      targetNormalized,
      fetchedTemplatesCount: allTemplates?.length || 0,
      fetchedTemplateNames: allTemplates?.map((t: any) => ({
        original: t.template_name,
        normalized: t.template_name.toLowerCase().replace(/_/g, '').trim()
      }))
    });

    // Find template by matching normalized versions string-to-string
    const matchedTemplate = (allTemplates || []).find((t: { template_name: string; body?: string | null; header?: string | null; footer?: string | null; buttons?: any[] }) => 
      t.template_name.toLowerCase().replace(/_/g, '').trim() === targetNormalized
    );

    console.log("🔍 MATCHED TEMPLATE RESULT:", matchedTemplate);

    let finalContent = `[Template: ${template_name}]`;
    let cleanTrackingVars = parameters || [];

    if (matchedTemplate) {
      // Correct our template_name reference to match database underscores perfectly
      template_name = matchedTemplate.template_name;

      // Calculate true placeholder slots in body/header text to filter out trailing PDF links
      const bodyMatches = matchedTemplate.body ? matchedTemplate.body.match(/{{\d+}}/g) || [] : [];
      const headerMatches = matchedTemplate.header ? matchedTemplate.header.match(/{{\d+}}/g) || [] : [];
      const totalVarCount = [...headerMatches, ...bodyMatches].length;

      // Slice the array to include ONLY the actual variables, removing PDF attachments
      if (totalVarCount > 0 && cleanTrackingVars.length > totalVarCount) {
        cleanTrackingVars = cleanTrackingVars.slice(0, totalVarCount);
      }

      // Reconstruct final compiled text content string for storage fallback updates
      let paramIndex = 0;
      const replacePlaceholders = (text: string | undefined) => {
        if (!text) return '';
        return text.replace(/\{\{(\d+)\}\}/g, () => {
          const val = cleanTrackingVars[paramIndex++];
          return val !== undefined && val !== null ? String(val) : '';
        });
      };

      const resolvedHeader = replacePlaceholders(matchedTemplate.header);
      const resolvedBody = replacePlaceholders(matchedTemplate.body);
      const resolvedFooter = replacePlaceholders(matchedTemplate.footer);

      let fullContent = '';
      if (resolvedHeader) fullContent += `*${resolvedHeader.trim()}*\n\n`;
      fullContent += resolvedBody;
      if (resolvedFooter) fullContent += `\n\n_${resolvedFooter.trim()}_`;
      
      if (fullContent.trim()) finalContent = fullContent.trim();
    }

    // 2. Resolve Contact
    const { data: contact, error: contactError } = await supabase
      .from('whatsapp_portal_contacts')
      .upsert({ user_id, phone_number: phone, name: phone, profile_name: phone }, { onConflict: 'user_id,phone_number' })
      .select('id').single();

    if (contactError || !contact) return NextResponse.json({ success: false, error: 'Contact error' }, { status: 500 });

    // 3. Resolve Conversation
    const { data: conversation, error: convError } = await supabase
      .from('whatsapp_portal_conversations')
      .upsert({ user_id, contact_id: contact.id, last_message: finalContent, last_message_at: new Date().toISOString() }, { onConflict: 'user_id,contact_id' })
      .select('id').single();

    if (convError || !conversation) return NextResponse.json({ success: false, error: 'Conversation error' }, { status: 500 });

    // 4. Upsert Message with PERFECT metadata column nesting alignment!
    const metadata = {
      parameters: cleanTrackingVars || [],
      media_url: resolvedMediaUrl,
      buttons: matchedTemplate?.buttons || []
    }; // 👈 Fixes the store.ts dynamic lookup pass!

    const { data: message, error: msgError } = await supabase
      .from('whatsapp_portal_messages')
      .upsert(
        {
          user_id,
          conversation_id: conversation.id,
          wa_message_id: wamid,
          direction: 'outbound',
          message_type: 'template',
          template_name, // Saved with correct underscores
          metadata,      // Saved inside nested schema block
          source: 'sheet',
          content: finalContent,
        },
        { onConflict: 'wa_message_id' }
      )
      .select('*').single();

    if (msgError) return NextResponse.json({ success: false, error: msgError.message }, { status: 500 });

    return NextResponse.json({ success: true, message });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}