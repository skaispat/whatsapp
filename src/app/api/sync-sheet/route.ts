import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePhoneNumber } from '@/lib/utils';

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseServiceRoleKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error('Missing Supabase environment variables');
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const body = await req.json();

    const {
      timestamp,
      event_type,
      message_id,
      from_number,
      from_name,
      to_number,
      status,
      message_type,
      content,
      context_message_id,
      raw_payload_template,
      interactive_type,
      interactive_id,
      interactive_title,
      interest_status
    } = body;

    // Validate that message_id exists since it is the conflict key
    if (!message_id) {
      return NextResponse.json(
        { success: false, error: 'message_id is required' },
        { status: 400 }
      );
    }

    // Resolve real user_id from whatsapp_portal_configs
    const { data: portalConfig } = await supabase
      .from('whatsapp_portal_configs')
      .select('user_id')
      .eq('phone_number_id', process.env.WHATSAPP_PHONE_NUMBER_ID!)
      .single();

    if (!portalConfig?.user_id) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp config not found' },
        { status: 400 }
      );
    }

    // Default mock user ID used in all other API routes
    const userId = portalConfig.user_id;

    // Determine direction and contact info based on event type
    let direction: 'inbound' | 'outbound' = 'inbound';
    let contactNumber = from_number;
    let contactName = from_name || from_number;

    if (event_type === 'STATUS_UPDATE') {
      direction = 'outbound';
      contactNumber = from_number; // In sheet's STATUS_UPDATE, from_number holds the customer phone number
      contactName = from_name || from_number;
    } else if (event_type === 'PORTAL_REPLY') {
      direction = 'outbound';
      contactNumber = to_number; // In PORTAL_REPLY, to_number is the customer
      contactName = to_number;
    } else if (event_type === 'INCOMING_MSG') {
      direction = 'inbound';
      contactNumber = from_number; // customer phone
      contactName = from_name || from_number;
    } else {
      // Fallback
      const isOutbound = ['sent', 'delivered', 'read', 'failed'].includes(String(status).toLowerCase()) || event_type === 'message_sent';
      contactNumber = isOutbound ? to_number : from_number;
      contactName = isOutbound ? to_number : (from_name || from_number);
      direction = isOutbound ? 'outbound' : 'inbound';
    }

    if (!contactNumber) {
      return NextResponse.json(
        { success: false, error: 'No contact number (from_number/to_number) provided' },
        { status: 400 }
      );
    }

    contactNumber = normalizePhoneNumber(contactNumber);

    // Sentiment / Interest detection fallback
    let resolvedInterestStatus = interest_status || null;
    if (!resolvedInterestStatus && direction === 'inbound') {
      const normalized = (content || '').toLowerCase().trim();
      const interestedWords = ["yes", "haan", "interested", "ok", "confirm", "done", "sure", "agree"];
      const notInterestedWords = ["no", "nahi", "cancel", "reject", "stop", "ignore"];
      
      const isInterested = interestedWords.some(w => normalized.includes(w));
      const isNotInterested = notInterestedWords.some(w => normalized.includes(w));

      if (isInterested) {
        resolvedInterestStatus = "Interested";
      } else if (isNotInterested) {
        resolvedInterestStatus = "Not Interested";
      } else {
        resolvedInterestStatus = "Other";
      }
    } else if (!resolvedInterestStatus) {
      resolvedInterestStatus = "Other";
    }

    // 1. Resolve Contact (with user_id to match webhook/portal schema)
    let contactId;
    let { data: existingContacts } = await supabase
      .from('whatsapp_portal_contacts')
      .select('id')
      .eq('user_id', userId)
      .eq('phone_number', contactNumber)
      .limit(1);
    
    if (existingContacts && existingContacts.length > 0) {
      contactId = existingContacts[0].id;
    } else {
      const { data: newContact, error: contactErr } = await supabase
        .from('whatsapp_portal_contacts')
        .insert({ 
          user_id: userId,
          phone_number: contactNumber, 
          name: contactName, 
          profile_name: contactName 
        })
        .select('id')
        .single();
      
      if (contactErr) {
        console.error('Error inserting contact:', contactErr);
        return NextResponse.json({ success: false, error: 'Failed to create contact: ' + contactErr.message }, { status: 500 });
      }
      contactId = newContact?.id;
    }

    // 2. Resolve Conversation (with user_id to match webhook/portal schema)
    let conversationId;
    let { data: existingConvs } = await supabase
      .from('whatsapp_portal_conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .limit(1);

    if (existingConvs && existingConvs.length > 0) {
      conversationId = existingConvs[0].id;
      // Update last message
      await supabase.from('whatsapp_portal_conversations').update({
        last_message: content || `[${message_type}]`,
        last_message_at: timestamp
      }).eq('id', conversationId);
    } else {
      const { data: newConv, error: convErr } = await supabase
        .from('whatsapp_portal_conversations')
        .insert({ 
          user_id: userId,
          contact_id: contactId, 
          last_message: content || `[${message_type}]`, 
          last_message_at: timestamp 
        })
        .select('id')
        .single();
        
      if (convErr) {
        console.error('Error inserting conversation:', convErr);
        return NextResponse.json({ success: false, error: 'Failed to create conversation: ' + convErr.message }, { status: 500 });
      }
      conversationId = newConv?.id;
    }

    // 3. Upsert Message (with user_id to match webhook/portal schema)
    const msgData: any = {
      user_id: userId,
      conversation_id: conversationId,
      wa_message_id: message_id,
      direction: direction,
      content: content,
      message_type: message_type || 'text',
      status: status || 'sent',
      created_at: timestamp,
      interactive_type: interactive_type || null,
      interactive_id: interactive_id || null,
      interactive_title: interactive_title || null,
      context_message_id: context_message_id || null,
      interest_status: resolvedInterestStatus,
    };

    if (status === 'delivered') msgData.delivered_at = timestamp;
    if (status === 'read') {
      msgData.delivered_at = timestamp;
      msgData.seen_at = timestamp;
    }

    const { error: msgError } = await supabase
      .from('whatsapp_portal_messages')
      .upsert(msgData, { onConflict: 'wa_message_id' });

    if (msgError) {
      console.error('Supabase upsert error:', msgError);
      return NextResponse.json(
        { success: false, error: msgError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });

  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
