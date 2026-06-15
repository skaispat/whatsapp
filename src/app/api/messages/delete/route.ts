import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import axios from 'axios';

export async function POST(request: NextRequest) {
  try {
    const { message_id, phone_number_id, user_id, delete_type } = await request.json();

    // 1. Basic validation of payload inputs
    if (!message_id || !user_id || !delete_type) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: message_id, user_id, or delete_type.' },
        { status: 400 }
      );
    }

    if (delete_type !== 'me' && delete_type !== 'everyone') {
      return NextResponse.json(
        { success: false, error: "Invalid delete_type. Must be 'me' or 'everyone'." },
        { status: 400 }
      );
    }

    if (delete_type === 'everyone' && !phone_number_id) {
      return NextResponse.json(
        { success: false, error: 'Missing phone_number_id for "everyone" deletion type.' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 2. Fetch the target message row from database
    const { data: dbMessage, error: fetchErr } = await supabase
      .from('whatsapp_portal_messages')
      .select('id, created_at, direction, content, message_type, metadata')
      .eq('wa_message_id', message_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (fetchErr) {
      console.error('Database fetch error:', fetchErr);
      return NextResponse.json(
        { success: false, error: 'Failed to retrieve message metadata from database.' },
        { status: 500 }
      );
    }

    if (!dbMessage) {
      return NextResponse.json(
        { success: false, error: 'Message not found in database.' },
        { status: 404 }
      );
    }

    // 3. Handle Local Deletion (Delete for Me)
    if (delete_type === 'me') {
      const existingMetadata = dbMessage.metadata && typeof dbMessage.metadata === 'object' ? dbMessage.metadata : {};
      const updatedMetadata = {
        ...existingMetadata,
        hidden_for_user: true,
        hidden_at: new Date().toISOString(),
      };

      const { error: updateErr } = await supabase
        .from('whatsapp_portal_messages')
        .update({
          metadata: updatedMetadata,
        })
        .eq('id', dbMessage.id);

      if (updateErr) {
        console.error('Failed to hide message for user:', updateErr);
        return NextResponse.json(
          { success: false, error: 'Failed to delete message locally.' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Message deleted for you successfully.',
      });
    }

    // 4. Handle Meta Message Revocation (Delete for Everyone)
    // 4a. Status Code Handling: Catch early if message was already revoked or deleted previously
    if (dbMessage.message_type === 'revoked' || dbMessage.content === '🚫 This message was deleted') {
      return NextResponse.json({
        success: true,
        message: 'Message has already been revoked or deleted previously.',
      });
    }

    // 4b. Direction Constraint: Enforce only deleting messages sent by us
    if (dbMessage.direction !== 'outbound') {
      return NextResponse.json(
        { success: false, error: 'Cannot delete inbound messages for everyone. Only outbound messages are eligible.' },
        { status: 400 }
      );
    }

    // 4c. Time Limit Window Check: Enforce strict 24-hour limit
    const messageTime = new Date(dbMessage.created_at).getTime();
    const hoursElapsed = (Date.now() - messageTime) / (1000 * 60 * 60);

    if (hoursElapsed > 24) {
      return NextResponse.json(
        { success: false, error: 'Time window expired. Messages older than 24 hours cannot be deleted for everyone.' },
        { status: 400 }
      );
    }

    // 4d. Retrieve Meta Access Token from config (with environment variable fallback)
    const { data: config, error: configErr } = await supabase
      .from('whatsapp_portal_configs')
      .select('access_token')
      .eq('phone_number_id', phone_number_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (configErr) {
      console.error('Config fetch error:', configErr);
    }

    const accessToken = config?.access_token || process.env.WHATSAPP_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp credentials or access token are not configured.' },
        { status: 400 }
      );
    }

    // 4e. Make request to Meta Graph API
    try {
      const url = `https://graph.facebook.com/v18.0/${phone_number_id}/messages`;
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'revoked',
          message_id: message_id,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // 4f. Database State Realignment: Update message row on success
      const existingMetadata = dbMessage.metadata && typeof dbMessage.metadata === 'object' ? dbMessage.metadata : {};
      const updatedMetadata = {
        ...existingMetadata,
        revoked: true,
        revoked_at: new Date().toISOString(),
      };

      const { error: updateErr } = await supabase
        .from('whatsapp_portal_messages')
        .update({
          content: '🚫 This message was deleted',
          message_type: 'revoked',
          metadata: updatedMetadata,
        })
        .eq('id', dbMessage.id);

      if (updateErr) {
        console.error('Failed to align database state after revocation:', updateErr);
      }

      return NextResponse.json({
        success: true,
        message: 'Message successfully revoked for everyone.',
      });

    } catch (err: any) {
      console.error('Meta Graph API revocation request failed:', err.response?.data || err.message);

      const metaError = err.response?.data?.error;

      // Handle cases where Meta API tells us it's already revoked/deleted
      if (metaError && (
        metaError.error_subcode === 2207011 || 
        metaError.message?.toLowerCase().includes('already') || 
        metaError.message?.toLowerCase().includes('revoked')
      )) {
        // Treat as success and align local database state
        const existingMetadata = dbMessage.metadata && typeof dbMessage.metadata === 'object' ? dbMessage.metadata : {};
        const updatedMetadata = {
          ...existingMetadata,
          revoked: true,
          revoked_at: new Date().toISOString(),
        };

        await supabase
          .from('whatsapp_portal_messages')
          .update({
            content: '🚫 This message was deleted',
            message_type: 'revoked',
            metadata: updatedMetadata,
          })
          .eq('id', dbMessage.id);

        return NextResponse.json({
          success: true,
          message: 'Message was already revoked on WhatsApp (database state aligned).',
        });
      }

      // If other Meta API rejection occurs, forward the details
      if (metaError) {
        return NextResponse.json(
          { 
            success: false, 
            error: metaError.message || 'Meta API rejected the revocation request.',
            metaErrors: [metaError] 
          },
          { status: err.response?.status || 400 }
        );
      }

      return NextResponse.json(
        { success: false, error: err.message || 'Network or internal server error during revocation request.' },
        { status: 500 }
      );
    }

  } catch (err: any) {
    console.error('Unhandled error in delete API route:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'An unexpected server error occurred.' },
      { status: 500 }
    );
  }
}
