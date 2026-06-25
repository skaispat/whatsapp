import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchWhatsAppTemplates, resolveTemplateInfo } from "@/lib/whatsapp";
import { normalizePhoneNumber } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: config } = await supabase
    .from("whatsapp_portal_configs")
    .select("webhook_verify_token")
    .eq("user_id", userId)
    .single();

  const verifyToken = config?.webhook_verify_token;

  if (!verifyToken || verifyToken !== token) {
    console.error(`\n❌ Webhook Verification Failed for user ${userId}`);
    console.error(`   Meta sent token: "${token}"`);
    console.error(`   Your DB has token: "${verifyToken}"`);
    console.error(`   Please ensure these match exactly!\n`);
    return new Response("Forbidden", { status: 403 });
  }

  console.log(`\n✅ Webhook Verified successfully for user: ${userId}\n`);
  // Return challenge as plain text for Meta verification
  return new Response(challenge, { status: 200 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  let payloadId: string | null = null;
  const supabase = createAdminClient();

  try {
    const body = await request.json();

    console.log("=== WEBHOOK HIT ===", JSON.stringify(body, null, 2));
    console.log("=== WEBHOOK USER ID ===", userId);

    // 1. Raw Webhook Logger
    try {
      const { data: insertedPayload, error: insertPayloadErr } = await supabase
        .from("webhook_payloads")
        .insert({
          user_id: userId,
          payload: body,
          processed: false,
        })
        .select("id")
        .single();

      if (insertPayloadErr) {
        console.warn("⚠️ Warning: Failed to insert raw webhook payload:", insertPayloadErr);
      } else if (insertedPayload) {
        payloadId = insertedPayload.id;
      }
    } catch (dbErr) {
      console.warn("⚠️ Warning: Failed to insert raw webhook payload (catch):", dbErr);
    }

    console.log("👉 Full Webhook Body:", JSON.stringify(body, null, 2));

    const entry = body?.entry?.[0];
    if (!entry) {
      if (payloadId) {
        await supabase.from("webhook_payloads").update({ processed: true }).eq("id", payloadId).maybeSingle();
      }
      return NextResponse.json({ status: "ok" });
    }

    const changes = entry.changes?.[0]?.value;
    if (!changes) {
      if (payloadId) {
        await supabase.from("webhook_payloads").update({ processed: true }).eq("id", payloadId).maybeSingle();
      }
      return NextResponse.json({ status: "ok" });
    }

    console.log(
      "👉 Changes Payload received:",
      JSON.stringify(changes, null, 2),
    );

    // Handle incoming messages
    if (changes.messages && changes.messages.length > 0) {
      for (const msg of changes.messages) {
        const phoneNumber = normalizePhoneNumber(msg.from);
        const profileName = changes.contacts?.[0]?.profile?.name || phoneNumber;
        const waMessageId = msg.id;
        const messageType = msg.type || "text";
        const contextMessageId = msg.context?.id || null;

        // ── Handle Reactions — update existing message, don't create new one ──
        if (messageType === "reaction") {
          const reactedMsgId = msg.reaction?.message_id;
          const emoji = msg.reaction?.emoji || "";

          if (reactedMsgId) {
            console.log(`😀 Reaction received: "${emoji}" on message ${reactedMsgId} from ${phoneNumber}`);

            // Fetch the current reactions on the target message
            const { data: targetMsg } = await supabase
              .from("whatsapp_portal_messages")
              .select("id, reactions")
              .eq("wa_message_id", reactedMsgId)
              .eq("user_id", userId)
              .maybeSingle();

            if (targetMsg) {
              const currentReactions: any[] = targetMsg.reactions || [];

              if (emoji) {
                // Add or update reaction from this sender
                const existingIdx = currentReactions.findIndex(
                  (r: any) => r.sender === "customer"
                );
                if (existingIdx >= 0) {
                  currentReactions[existingIdx].emoji = emoji;
                } else {
                  currentReactions.push({ emoji, sender: "customer" });
                }
              } else {
                // Empty emoji = remove reaction from this sender
                const filtered = currentReactions.filter(
                  (r: any) => r.sender !== "customer"
                );
                currentReactions.length = 0;
                currentReactions.push(...filtered);
              }

              await supabase
                .from("whatsapp_portal_messages")
                .update({ reactions: currentReactions })
                .eq("id", targetMsg.id);

              console.log(`✅ Reaction updated on message ${reactedMsgId}`);
            } else {
              console.warn(`⚠️ Reaction target message ${reactedMsgId} not found in DB`);
            }
          }
          continue; // Don't create a new message row for reactions
        }

        // ── Extract content and media based on message type ───────────────
        let messageContent = "";
        let mediaArray: any[] = [];
        let mimeType: string | null = null;
        let fileSize: number | null = null;

        let interactiveType: string | null = null;
        let interactiveId: string | null = null;
        let interactiveTitle: string | null = null;

        switch (messageType) {
          case "text":
            messageContent = msg.text?.body || "";
            break;

          case "interactive": {
            const type = msg.interactive?.type;
            if (type === "button_reply") {
              interactiveType = "button_reply";
              interactiveId = msg.interactive?.button_reply?.id || null;
              interactiveTitle = msg.interactive?.button_reply?.title || null;
              messageContent = interactiveTitle || "";
            } else if (type === "list_reply") {
              interactiveType = "list_reply";
              interactiveId = msg.interactive?.list_reply?.id || null;
              interactiveTitle = msg.interactive?.list_reply?.title || null;
              messageContent = interactiveTitle || "";
            }
            break;
          }

          case "button": {
            interactiveType = "button";
            interactiveId = msg.button?.payload || null;
            interactiveTitle = msg.button?.text || null;
            messageContent = interactiveTitle || "";
            break;
          }

          case "image":
            messageContent = msg.image?.caption || "";
            mimeType = msg.image?.mime_type || "image/jpeg";
            fileSize = msg.image?.file_size || null;
            mediaArray.push({
              type: "image",
              id: msg.image?.id,
              mime_type: mimeType,
              file_size: fileSize,
            });
            break;

          case "video":
            messageContent = msg.video?.caption || "";
            mimeType = msg.video?.mime_type || "video/mp4";
            fileSize = msg.video?.file_size || null;
            mediaArray.push({
              type: "video",
              id: msg.video?.id,
              mime_type: mimeType,
              file_size: fileSize,
            });
            break;

          case "document":
            messageContent = msg.document?.caption || "";
            mimeType = msg.document?.mime_type || "application/pdf";
            fileSize = msg.document?.file_size || null;
            mediaArray.push({
              type: "document",
              id: msg.document?.id,
              fileName: msg.document?.filename || "Document",
              mime_type: mimeType,
              file_size: fileSize,
            });
            break;

          case "audio":
            messageContent = "";
            mimeType = msg.audio?.mime_type || "audio/ogg";
            fileSize = msg.audio?.file_size || null;
            mediaArray.push({
              type: "audio",
              id: msg.audio?.id,
              mime_type: mimeType,
              file_size: fileSize,
            });
            break;

          case "sticker":
            messageContent = "[Sticker]";
            mimeType = msg.sticker?.mime_type || "image/webp";
            mediaArray.push({
              type: "sticker",
              id: msg.sticker?.id,
              mime_type: mimeType,
            });
            break;

          case "location": {
            const lat = msg.location?.latitude;
            const lng = msg.location?.longitude;
            messageContent = `📍 Location: ${lat}, ${lng}`;
            break;
          }

          case "contacts": {
            const contactName = msg.contacts?.[0]?.name?.formatted_name || "Contact";
            messageContent = `👤 Shared contact: ${contactName}`;
            break;
          }

          default:
            messageContent = msg.text?.body || msg.caption || `[${messageType}]`;
            break;
        }

        // If content is still empty for media messages, set a descriptive placeholder
        if (!messageContent && mediaArray.length > 0) {
          messageContent = `[${messageType.charAt(0).toUpperCase() + messageType.slice(1)}]`;
        }

        // Sentiment / Interest Classifier
        let interestStatus = "Other";
        const normalized = messageContent.toLowerCase().trim();
        const interestedWords = ["yes", "haan", "interested", "ok", "confirm", "done", "sure", "agree"];
        const notInterestedWords = ["no", "nahi", "cancel", "reject", "stop", "ignore"];

        const isInterested = interestedWords.some(w => normalized.includes(w));
        const isNotInterested = notInterestedWords.some(w => normalized.includes(w));

        if (isInterested) {
          interestStatus = "Interested";
        } else if (isNotInterested) {
          interestStatus = "Not Interested";
        }

        // Upsert contact
        const { data: contact, error: contactError } = await supabase
          .from("whatsapp_portal_contacts")
          .upsert(
            {
              user_id: userId,
              phone_number: phoneNumber,
              name: profileName,
              profile_name: profileName,
            },
            { onConflict: "user_id,phone_number" },
          )
          .select("id")
          .single();

        if (contactError || !contact) {
          console.error("❌ Error upserting contact:", contactError);
          continue;
        }

        // Upsert conversation
        const { data: conversation, error: convError } = await supabase
          .from("whatsapp_portal_conversations")
          .upsert(
            {
              user_id: userId,
              contact_id: contact.id,
              last_message: messageContent || `[${messageType}]`,
              last_message_at: new Date().toISOString(),
            },
            { onConflict: "user_id,contact_id" },
          )
          .select("id, unread_count")
          .single();

        if (convError || !conversation) {
          console.error("❌ Error upserting conversation:", convError);
          continue;
        }

        // Increment unread count
        await supabase
          .from("whatsapp_portal_conversations")
          .update({ unread_count: (conversation.unread_count || 0) + 1 })
          .eq("id", conversation.id);

        // Build insert data using actual DB column names
        const insertData: Record<string, any> = {
          user_id: userId,
          conversation_id: conversation.id,
          wa_message_id: waMessageId,
          direction: "inbound",
          content: messageContent,
          message_type: messageType,
          status: "sent",
          interactive_type: interactiveType,
          interactive_id: interactiveId,
          interactive_title: interactiveTitle,
          context_message_id: contextMessageId,
          interest_status: interestStatus,
        };

        // Add media fields using actual column names from messages table
        if (mimeType) insertData.mime_type = mimeType;
        if (fileSize) insertData.file_size = fileSize;
        if (mediaArray.length > 0) insertData.media = mediaArray;

        // Insert message
        const { error: msgInsertError } = await supabase
          .from("whatsapp_portal_messages")
          .insert(insertData);

        if (msgInsertError) {
          console.error("❌ Error inserting incoming message:", msgInsertError);
        } else {
          console.log(
            `✅ Success: ${messageType} message inserted for user ${userId} (wamid: ${waMessageId})`,
          );
        }
      }
    }

    // Handle status updates (delivered / read)
    if (changes.statuses && changes.statuses.length > 0) {
      for (const status of changes.statuses) {
        const waMessageId = status.id;
        const statusValue = status.status; // sent, delivered, read, failed
        const opaque = status.biz_opaque_callback_data; // This is the gold!
        const templateName = opaque?.startsWith("tpl:") ? opaque.slice(4) : opaque;
        const timestamp = status.timestamp
          ? new Date(parseInt(status.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        const updateData: Record<string, any> = { status: statusValue };
        let errorCode = 'N/A';
        let errorMessage = 'N/A';

        if (statusValue === "delivered") {
          updateData.delivered_at = timestamp;
        } else if (statusValue === "read") {
          updateData.delivered_at = updateData.delivered_at || timestamp;
          updateData.seen_at = timestamp;
        } else if (statusValue === "failed") {
          errorCode = status.errors?.[0]?.code?.toString() || 'N/A';
          errorMessage = status.errors?.[0]?.message || status.errors?.[0]?.title || 'N/A';
          console.error(
            `\n❌ WhatsApp Message Failed Delivery (wamid: ${waMessageId}): code=${errorCode}, message=${errorMessage}`,
          );

          // Get the existing message's metadata so we don't overwrite other metadata fields
          const { data: existingMsg } = await supabase
            .from("whatsapp_portal_messages")
            .select("metadata")
            .eq("wa_message_id", waMessageId)
            .eq("user_id", userId)
            .maybeSingle();

          const existingMetadata = existingMsg?.metadata || {};
          updateData.metadata = {
            ...existingMetadata,
            error_code: errorCode,
            error_message: errorMessage,
          };
        }

        if (status.pricing?.category) {
          updateData.pricing_category = status.pricing.category;
        }

        // If we have callback data (template name), use it
        if (templateName) {
          updateData.template_name = templateName;
        }

        // Add returning representation to catch when a record is not found!
        const { data: updatedRecord, error: statusUpdateError } = await supabase
          .from("whatsapp_portal_messages")
          .update(updateData)
          .eq("wa_message_id", waMessageId)
          .eq("user_id", userId)
          .select("id")
          .maybeSingle();

        console.log("Update Attempt:", { updatedRecord, statusUpdateError, waMessageId, userId });

        if (statusUpdateError) {
          console.error("❌ Error updating message status:", statusUpdateError);
        } else if (!updatedRecord) {
          // Check if this status ID belongs to a reaction we sent
          if (waMessageId) {
            const { data: reactionParentMsg } = await supabase
              .from("whatsapp_portal_messages")
              .select("id")
              .contains("metadata", { sent_reaction_ids: [waMessageId] })
              .maybeSingle();

            if (reactionParentMsg) {
              console.log(`✅ Status update for reaction ${waMessageId} received. Ignoring template fallback.`);
              continue;
            }
          }

          console.warn(
            `⚠️ Warning: Status '${statusValue}' received, but no matching message found in DB for wa_message_id: ${waMessageId}`,
          );

          // Fallback: If a message was sent externally (e.g. Template via Meta API), resolve the actual template text
          if (status.recipient_id) {
            console.log(
              `♻️ Creating external template message for ${waMessageId} to ${status.recipient_id}`,
            );

            // Fetch the user's WhatsApp config to get WABA ID and access token
            const { data: config } = await supabase
              .from("whatsapp_portal_configs")
              .select("waba_id, access_token")
              .eq("user_id", userId)
              .single();

            // Resolve the actual template body text by checking local cache first, then Meta API
            let templateContent = "[Template Message]";
            let resolvedTemplateName = templateName || "Unknown";
            let resolvedTemplateId: string | null = null;

            // 1. Try local cache first
            if (userId) {
              const { data: cachedTemplates } = await supabase
                .from("whatsapp_portal_templates")
                .select("id, template_name, body, category")
                .eq("user_id", userId);

              if (cachedTemplates && cachedTemplates.length > 0) {
                const pricingCategory = status.pricing?.category; // e.g. "utility", "marketing"
                const mappedTemplates = cachedTemplates.map((t: any) => ({
                  id: t.id,
                  name: t.template_name,
                  category: t.category || '',
                  body: t.body || ''
                }));
                const info = resolveTemplateInfo(mappedTemplates, pricingCategory, templateName);
                if (info.name !== "unknown" && info.name !== "Unknown" && info.body !== "[Template Message]") {
                  templateContent = info.body;
                  resolvedTemplateName = info.name;
                  const matchedCache = cachedTemplates.find(
                    (t: any) => t.template_name.toLowerCase() === resolvedTemplateName.toLowerCase()
                  );
                  if (matchedCache) {
                    resolvedTemplateId = matchedCache.id;
                  }
                  console.log(`📋 Resolved template from DB Cache: ${resolvedTemplateName}`);
                }
              }
            }

            // 2. Fallback to Meta API if still Unknown or default content
            if ((resolvedTemplateName === "unknown" || resolvedTemplateName === "Unknown" || templateContent === "[Template Message]") && config?.waba_id && config?.access_token) {
              const pricingCategory = status.pricing?.category; // e.g. "utility", "marketing"
              console.log(
                `📋 Fetching templates from Meta (WABA: ${config.waba_id}, category: ${pricingCategory}, hint: ${templateName})...`,
              );
              const templates = await fetchWhatsAppTemplates({
                wabaId: config.waba_id,
                accessToken: config.access_token,
              });
              
              const info = resolveTemplateInfo(templates, pricingCategory, templateName);
              if (info.name !== "unknown" && info.name !== "Unknown" && info.body !== "[Template Message]") {
                templateContent = info.body;
                resolvedTemplateName = info.name;
                console.log(`📋 Resolved template from Meta API: ${resolvedTemplateName}`);
              }
            }

            const { data: contact, error: contactError } = await supabase
              .from("whatsapp_portal_contacts")
              .upsert(
                { user_id: userId, phone_number: normalizePhoneNumber(status.recipient_id) },
                { onConflict: "user_id,phone_number" },
              )
              .select("id")
              .single();

            if (!contactError && contact) {
              const { data: conversation, error: convError } = await supabase
                .from("whatsapp_portal_conversations")
                .upsert(
                  {
                    user_id: userId,
                    contact_id: contact.id,
                    last_message: templateContent,
                    last_message_at: timestamp,
                  },
                  { onConflict: "user_id,contact_id" },
                )
                .select("id")
                .single();

              if (!convError && conversation) {
                const insertData: any = {
                  user_id: userId,
                  conversation_id: conversation.id,
                  wa_message_id: waMessageId,
                  direction: "outbound",
                  content: templateContent,
                  message_type: "template",
                  template_id: resolvedTemplateId || null,
                  template_name: resolvedTemplateName,
                  status: statusValue,
                  created_at: timestamp,
                  pricing_category: status.pricing?.category,
                  metadata: {
                    error_code: errorCode,
                    error_message: errorMessage
                  }
                };
                if (statusValue === "delivered")
                  insertData.delivered_at = timestamp;
                if (statusValue === "read") {
                  insertData.delivered_at = timestamp;
                  insertData.seen_at = timestamp;
                }

                const { error: insertErr } = await supabase
                  .from("whatsapp_portal_messages")
                  .insert(insertData);
                if (!insertErr) {
                  console.log(
                    `✅ Success: Template message inserted with real content`,
                  );
                } else if (insertErr.code === "23505") {
                  console.log(
                    `⚠️ Duplicate key for ${waMessageId} (already exists). Updating status instead.`,
                  );
                  const { error: retryUpdateErr } = await supabase
                    .from("whatsapp_portal_messages")
                    .update(updateData)
                    .eq("wa_message_id", waMessageId);
                  if (retryUpdateErr)
                    console.error(
                      "❌ Error retrying message update after duplicate key:",
                      retryUpdateErr,
                    );
                } else {
                  console.error(
                    "❌ Error inserting template message:",
                    insertErr,
                  );
                }
              }
            }
          }
        } else {
          console.log(
            `✅ Success: Status '${statusValue}' updated for message ${waMessageId}`,
          );
        }
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }

  if (payloadId) {
    try {
      await supabase
        .from("webhook_payloads")
        .update({ processed: true })
        .eq("id", payloadId)
        .maybeSingle();
    } catch (dbErr) {
      console.warn("⚠️ Warning: Failed to set payload processed: true", dbErr);
    }
  }

  return NextResponse.json({ status: "ok" });
}
