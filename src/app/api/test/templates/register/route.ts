import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("🚨 RAW INCOMING PAYLOAD FROM SHEET:", JSON.stringify(body, null, 2));
    
    let { user_id, wamid, phone, template_name, parameters, media_url } = body;
    console.log("🔍 Media URL check:", media_url);
    const resolvedMediaUrl = media_url || "";
    const isImage = resolvedMediaUrl ? (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(resolvedMediaUrl) || resolvedMediaUrl.includes("image")) : false;
    const messageType = resolvedMediaUrl ? (isImage ? 'image' : 'document') : 'template';

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
      .select('id, template_name, body, header, footer, buttons')
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
    const matchedTemplate = (allTemplates || []).find((t: { id: string; template_name: string; body?: string | null; header?: string | null; footer?: string | null; buttons?: any[] }) => 
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
    // Fetch existing contact name first to protect it from being overwritten by raw phone numbers
    const { data: existingContact, error: fetchContactError } = await supabase
      .from('whatsapp_portal_contacts')
      .select('id, name, profile_name')
      .eq('user_id', user_id)
      .eq('phone_number', phone)
      .maybeSingle();

    if (fetchContactError) {
      console.error('Error fetching existing contact:', fetchContactError);
    }

    let contactId = existingContact?.id;
    let contactError = null;

    if (existingContact) {
      // Check if existing row has non-empty name or profile_name
      const needsNameUpdate = !existingContact.name || existingContact.name.trim() === '';
      const needsProfileUpdate = !existingContact.profile_name || existingContact.profile_name.trim() === '';

      if (needsNameUpdate || needsProfileUpdate) {
        const updatePayload: Record<string, any> = {};
        if (needsNameUpdate) updatePayload.name = phone;
        if (needsProfileUpdate) updatePayload.profile_name = phone;

        const { error: updateErr } = await supabase
          .from('whatsapp_portal_contacts')
          .update(updatePayload)
          .eq('id', contactId);
        
        contactError = updateErr;
      }
    } else {
      // Contact is completely new; insert it
      const { data: newContact, error: insertContactErr } = await supabase
        .from('whatsapp_portal_contacts')
        .insert({
          user_id,
          phone_number: phone,
          name: phone,
          profile_name: phone
        })
        .select('id')
        .maybeSingle();

      if (insertContactErr) {
        if (insertContactErr.code === '23505') {
          // Handle concurrent insert write conflict fallback
          const { data: refetchedContact } = await supabase
            .from('whatsapp_portal_contacts')
            .select('id')
            .eq('user_id', user_id)
            .eq('phone_number', phone)
            .maybeSingle();
          contactId = refetchedContact?.id;
        } else {
          contactError = insertContactErr;
        }
      } else {
        contactId = newContact?.id;
      }
    }

    if (contactError || !contactId) return NextResponse.json({ success: false, error: 'Contact error' }, { status: 500 });
    const contact = { id: contactId };

    // 3. Resolve Conversation
    const { data: conversation, error: convError } = await supabase
      .from('whatsapp_portal_conversations')
      .upsert({ user_id, contact_id: contact.id, last_message: finalContent, last_message_at: new Date().toISOString() }, { onConflict: 'user_id,contact_id' })
      .select('id').single();

    if (convError || !conversation) return NextResponse.json({ success: false, error: 'Conversation error' }, { status: 500 });

    // 4. Resolve and merge Message with status protection & error metadata preservation!
    const incomingMetadata = {
      parameters: cleanTrackingVars || [],
      media_url: resolvedMediaUrl,
      buttons: matchedTemplate?.buttons || []
    };

    // Check if message already exists
    const { data: existingMsg, error: fetchMsgError } = await supabase
      .from('whatsapp_portal_messages')
      .select('status, metadata')
      .eq('wa_message_id', wamid)
      .maybeSingle();

    if (fetchMsgError) {
      console.error('Error fetching existing message for status protection:', fetchMsgError);
    }

    const protectedStatuses = ['failed', 'delivered', 'read'];
    const hasProtectedStatus = existingMsg && protectedStatuses.includes(existingMsg.status || '');

    // Deep merge metadata to preserve existing fields like error_code, error_message
    const finalMetadata = {
      ...(existingMsg?.metadata || {}),
      ...incomingMetadata
    };

    let message;
    let msgError;

    if (existingMsg) {
      // Perform status-protected UPDATE
      const updatePayload: Record<string, any> = {
        user_id,
        conversation_id: conversation.id,
        direction: 'outbound',
        message_type: messageType,
        template_id: matchedTemplate?.id || null,
        template_name,
        media_url: resolvedMediaUrl || null,
        metadata: finalMetadata,
        source: 'sheet',
        content: finalContent,
      };

      // Do not overwrite status if it's protected
      if (!hasProtectedStatus) {
        updatePayload.status = 'sent';
      }

      const { data: updatedMsg, error: updateErr } = await supabase
        .from('whatsapp_portal_messages')
        .update(updatePayload)
        .eq('wa_message_id', wamid)
        .select('*')
        .maybeSingle();

      message = updatedMsg;
      msgError = updateErr;
    } else {
      // Perform INSERT
      const insertPayload: Record<string, any> = {
        user_id,
        conversation_id: conversation.id,
        wa_message_id: wamid,
        direction: 'outbound',
        message_type: messageType,
        template_id: matchedTemplate?.id || null,
        template_name,
        media_url: resolvedMediaUrl || null,
        metadata: finalMetadata,
        source: 'sheet',
        content: finalContent,
        status: 'sent',
      };

      const { data: insertedMsg, error: insertErr } = await supabase
        .from('whatsapp_portal_messages')
        .insert(insertPayload)
        .select('*')
        .maybeSingle();

      if (insertErr && insertErr.code === '23505') {
        // Fallback update in case of concurrent write race condition
        console.warn('⚠️ Race condition detected during message insert. Retrying as update.');
        const { data: refetchedMsg } = await supabase
          .from('whatsapp_portal_messages')
          .select('status, metadata')
          .eq('wa_message_id', wamid)
          .maybeSingle();

        const latestMetadata = {
          ...(refetchedMsg?.metadata || {}),
          ...incomingMetadata
        };

        const latestHasProtectedStatus = refetchedMsg && protectedStatuses.includes(refetchedMsg.status || '');

        const fallbackPayload: Record<string, any> = {
          user_id,
          conversation_id: conversation.id,
          direction: 'outbound',
          message_type: messageType,
          template_id: matchedTemplate?.id || null,
          template_name,
          media_url: resolvedMediaUrl || null,
          metadata: latestMetadata,
          source: 'sheet',
          content: finalContent,
        };

        if (!latestHasProtectedStatus) {
          fallbackPayload.status = 'sent';
        }

        const { data: updatedMsg, error: updateErr } = await supabase
          .from('whatsapp_portal_messages')
          .update(fallbackPayload)
          .eq('wa_message_id', wamid)
          .select('*')
          .maybeSingle();

        message = updatedMsg;
        msgError = updateErr;
      } else {
        message = insertedMsg;
        msgError = insertErr;
      }
    }

    if (msgError) return NextResponse.json({ success: false, error: msgError.message }, { status: 500 });

    return NextResponse.json({ success: true, message });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}