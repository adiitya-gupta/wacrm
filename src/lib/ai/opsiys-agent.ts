import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiConfig, ChatMessage } from './types';
import type { AiLeadQualification, QualificationState, TimeSlot } from '@/types/meetings';
import { generateReply } from './generate';
import { HANDOFF_SENTINEL } from './defaults';
import { parseNaturalDateTime, isAffirmativeResponse, isNegativeResponse } from '@/lib/scheduling/nlp-datetime';
import {
  getAvailableSlots,
  isSlotAvailable,
  formatSlotsForWhatsApp,
  loadSchedulingSettings,
} from '@/lib/scheduling/availability';
import { bookMeeting, cancelMeeting } from '@/lib/scheduling/booking';

export type ConversationStage =
  | 'STAGE_1_BUSINESS'
  | 'STAGE_2_CHALLENGE'
  | 'STAGE_3_RECOMMEND_SERVICE'
  | 'STAGE_4_ASK_SERVICE_INTEREST'
  | 'STAGE_5_EXPLAIN_BENEFITS'
  | 'STAGE_6_INVITE_MEETING'
  | 'STAGE_7_COLLECT_DATETIME'
  | 'STAGE_8_CONFIRM_BOOK'
  | 'MEETING_BOOKED'
  | 'MEETING_CANCELLED'
  | 'HUMAN_HANDOFF'
  | 'OPT_OUT';

export interface OpsiysLeadState {
  business_type: string | null;
  target_customers: string | null;
  business_goal: string | null;
  primary_challenge: string | null;
  recommended_services: string[];
  selected_service: string | null;
  benefits_explained: boolean;
  meeting_interest: 'yes' | 'no' | 'undecided' | null;
  preferred_date: string | null;
  preferred_time: string | null;
  timezone: string;
  available_slots_checked: boolean;
  selected_slot: string | null;
  booking_status: 'none' | 'offered' | 'confirmed' | 'cancelled';
  meeting_link: string | null;
  conversation_stage: ConversationStage;
}

export interface OpsiysAgentArgs {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  messages: ChatMessage[];
  config: AiConfig;
  contactName?: string | null;
  contactPhone?: string | null;
}

export interface OpsiysAgentResult {
  text: string;
  handoff: boolean;
  state: QualificationState;
  bookedMeetingId?: string;
  leadSummary?: string;
}

export const OPSIYS_SERVICES = [
  'WhatsApp Automation & AI Chatbots',
  'Custom AI Agents & Customer Support Automation',
  'CRM Integrations & Lead Management Pipelines',
  'Lead Generation & Automated Qualification',
  'Modern Web & Application Development',
  'Email & Marketing Automation',
];

const OPT_OUT_REGEX =
  /\b(stop|unsubscribe|opt[\s-]?out|cancel\s+subscription|remove\s+me|don'?t\s+message\s+me)\b/i;

const HUMAN_REQUEST_REGEX =
  /\b(human|agent|person|representative|support|talk to someone|speak (to|with) someone|speak to a person)\b/i;

const PROACTIVE_MEETING_REGEX =
  /\b(book (a )?(meeting|call|demo)|schedule (a )?(call|meeting|demo)|set up (a )?call|calendar)\b/i;

/**
 * Main state-driven consultative OPSIYS AI Sales Representative & Automatic Meeting Booking Engine.
 */
export async function processOpsiysLeadConversation(
  args: OpsiysAgentArgs,
): Promise<OpsiysAgentResult> {
  const { db, accountId, conversationId, contactId, messages, config, contactName } = args;

  // Strict tenant boundary check: Never run OPSIYS agent for external paying accounts
  const configuredOpsiysId = process.env.OPSIYS_ACCOUNT_ID?.trim();
  if (configuredOpsiysId && accountId !== configuredOpsiysId) {
    throw new Error(
      `Tenant boundary violation: OPSIYS consultative agent invoked for non-OPSIYS account ${accountId}`,
    );
  }

  // 1. Load or initialize persistent AI qualification record from DB
  const qualification = await loadOrCreateQualification(db, accountId, contactId, conversationId);

  const lastUserTurn = [...messages].reverse().find((m) => m.role === 'user');
  const userText = lastUserTurn?.content || '';
  const now = new Date();
  const settings = await loadSchedulingSettings(db, accountId);
  const tz = settings.timezone || 'Asia/Kolkata';
  const tzLabel = formatTimezoneLabel(tz);

  // 2. Deserialize rich 16-field logical state from qualification_notes
  const state = deserializeStateFromNotes(qualification.qualification_notes, qualification, tz);

  // 3. Handle OPT-OUT immediately (STOP, UNSUBSCRIBE, etc.)
  if (OPT_OUT_REGEX.test(userText.trim())) {
    await db
      .from('conversations')
      .update({
        ai_autoreply_disabled: true,
        ai_handoff_summary: 'Customer opted out of automated messaging.',
      })
      .eq('id', conversationId);

    state.conversation_stage = 'OPT_OUT';
    const notes = serializeStateToNotes(formatLeadSummary(state), state);

    await updateQualificationState(db, qualification.id, {
      state: 'HUMAN_HANDOFF',
      qualification_notes: notes,
    });

    return {
      text: 'You have been unsubscribed and our automated messages have been paused. You will not receive further automated messages from us. If you ever wish to reconnect with OPSIYS, simply send a message anytime. Have a great day!',
      handoff: true,
      state: 'HUMAN_HANDOFF',
      leadSummary: formatLeadSummary(state),
    };
  }

  // 4. Handle Human Agent Request
  if (HUMAN_REQUEST_REGEX.test(userText.trim())) {
    state.conversation_stage = 'HUMAN_HANDOFF';
    const notes = serializeStateToNotes(formatLeadSummary(state), state);

    await updateQualificationState(db, qualification.id, {
      state: 'HUMAN_HANDOFF',
      qualification_notes: notes,
    });

    return {
      text: `I understand! Let me connect you with one of our human team members right away. Someone from OPSIYS will take over this chat shortly. 😊\n\n${HANDOFF_SENTINEL}`,
      handoff: true,
      state: 'HUMAN_HANDOFF',
      leadSummary: formatLeadSummary(state),
    };
  }

  // 5. Parse natural language intent, dates, and times
  const nlpResult = parseNaturalDateTime(userText, now, tz);

  // 6. Handle Cancellation of Existing Meeting
  if (nlpResult.isCancellation && (qualification.state === 'MEETING_BOOKED' || qualification.meeting_id)) {
    if (qualification.meeting_id) {
      await cancelMeeting(db, {
        meetingId: qualification.meeting_id,
        accountId,
        reason: 'Cancelled by customer via WhatsApp',
      });
    }

    state.conversation_stage = 'MEETING_CANCELLED';
    state.booking_status = 'cancelled';
    const notes = serializeStateToNotes('Meeting cancelled at customer request.', state);

    await updateQualificationState(db, qualification.id, {
      state: 'MEETING_CANCELLED',
      qualification_notes: notes,
    });

    return {
      text: 'No problem at all! I have cancelled your discovery meeting. Whenever you are ready to explore automating your business with OPSIYS, just message us here. Have a great day!',
      handoff: false,
      state: 'MEETING_CANCELLED',
      leadSummary: formatLeadSummary(state),
    };
  }

  // 7. Handle Reschedule Request for Existing Meeting
  if (nlpResult.isReschedule && qualification.meeting_id) {
    const slots = await getAvailableSlots(db, accountId, { limit: 3 });
    const formattedSlots = formatSlotsForWhatsApp(slots);

    state.conversation_stage = 'STAGE_7_COLLECT_DATETIME';
    state.booking_status = 'offered';
    const notes = serializeStateToNotes(formatLeadSummary(state), state);

    await updateQualificationState(db, qualification.id, {
      state: 'SLOT_SELECTION',
      proposed_slots: slots,
      qualification_notes: notes,
    });

    return {
      text: `Sure, I'd be happy to reschedule! Here are the next available slots:\n\n${formattedSlots}\n\nWhich slot works best for you? (You can also propose another date and time).`,
      handoff: false,
      state: 'SLOT_SELECTION',
      leadSummary: formatLeadSummary(state),
    };
  }

  // 8. Extract any newly volunteered prospect information
  const extracted = extractProspectInformation(userText, state);
  if (extracted.business_type && !state.business_type) state.business_type = extracted.business_type;
  if (extracted.target_customers && !state.target_customers) state.target_customers = extracted.target_customers;
  if (extracted.primary_challenge && !state.primary_challenge) state.primary_challenge = extracted.primary_challenge;
  if (extracted.selected_service && !state.selected_service) state.selected_service = extracted.selected_service;
  if (extracted.meeting_interest) state.meeting_interest = extracted.meeting_interest;

  // 9. Fast-forward if prospect proactively requests a meeting
  if (
    PROACTIVE_MEETING_REGEX.test(userText) &&
    state.conversation_stage !== 'STAGE_7_COLLECT_DATETIME' &&
    state.conversation_stage !== 'STAGE_8_CONFIRM_BOOK'
  ) {
    state.meeting_interest = 'yes';
    state.conversation_stage = 'STAGE_7_COLLECT_DATETIME';
  }

  // 10. Check if in Stage 6 prospect agreed or declined meeting
  if (state.conversation_stage === 'STAGE_6_INVITE_MEETING') {
    if (nlpResult.isAffirmative || isAffirmativeResponse(userText) || state.meeting_interest === 'yes') {
      state.meeting_interest = 'yes';
      state.conversation_stage = 'STAGE_7_COLLECT_DATETIME';

      // If user provided date/time in the same message (e.g. "Yes, Monday at 11am"), fall through to scheduling below.
      if (!nlpResult.hasDateTime) {
        const notes = serializeStateToNotes(formatLeadSummary(state), state);
        await updateQualificationState(db, qualification.id, {
          state: 'SLOT_SELECTION',
          qualification_notes: notes,
        });

        return {
          text: 'Perfect! 🙌 What day and time usually work best for you? I will check our available slots and help schedule your call with our team.',
          handoff: false,
          state: 'SLOT_SELECTION',
          leadSummary: formatLeadSummary(state),
        };
      }
    } else if (nlpResult.isNegative || isNegativeResponse(userText) || state.meeting_interest === 'no') {
      state.meeting_interest = 'no';
      const notes = serializeStateToNotes(formatLeadSummary(state), state);
      await updateQualificationState(db, qualification.id, {
        state: 'MEETING_OFFERED',
        qualification_notes: notes,
      });

      return {
        text: 'No problem at all! 😊 We are here whenever you are ready. Feel free to explore or reach out anytime if you want to look at automating your business down the road. Have a great day!',
        handoff: false,
        state: 'MEETING_OFFERED',
        leadSummary: formatLeadSummary(state),
      };
    }
  }

  // 11. STAGE 7 & 8 SCHEDULING WORKFLOW
  // If we are actively in scheduling stages or user provided a concrete date/time preference
  const isSchedulingStage =
    state.conversation_stage === 'STAGE_7_COLLECT_DATETIME' ||
    state.conversation_stage === 'STAGE_8_CONFIRM_BOOK' ||
    qualification.state === 'SLOT_SELECTION' ||
    Boolean(
      nlpResult.selectedOptionIndex !== undefined &&
        qualification.proposed_slots &&
        qualification.proposed_slots.length > 0,
    );

  if (isSchedulingStage) {
    // 10A. Check if user selected one of the proposed alternative options (1, 2, 3, etc.)
    if (
      nlpResult.selectedOptionIndex !== undefined &&
      qualification.proposed_slots &&
      qualification.proposed_slots[nlpResult.selectedOptionIndex]
    ) {
      const chosenSlot = qualification.proposed_slots[nlpResult.selectedOptionIndex];
      const isFree = await isSlotAvailable(db, accountId, chosenSlot.startTime, chosenSlot.endTime);

      if (isFree) {
        return await executeMeetingBooking({
          db,
          accountId,
          contactId,
          conversationId,
          qualification,
          state,
          candidateSlot: chosenSlot,
          settings,
          contactName,
          tzLabel,
        });
      } else {
        return await offerAlternativeSlots({
          db,
          accountId,
          qualification,
          state,
          messagePrefix: 'That slot was just booked by someone else! Here are other open slots:\n\n',
        });
      }
    }

    // 10B. Check if user is confirming an available slot in STAGE_8_CONFIRM_BOOK
    if (
      state.conversation_stage === 'STAGE_8_CONFIRM_BOOK' &&
      (nlpResult.isAffirmative || isAffirmativeResponse(userText)) &&
      (state.selected_slot || (qualification.proposed_slots && qualification.proposed_slots.length > 0))
    ) {
      const slotStartTime = state.selected_slot || qualification.proposed_slots[0].startTime;
      const slotStart = new Date(slotStartTime);
      const slotEnd = new Date(slotStart.getTime() + settings.meeting_duration_minutes * 60 * 1000);

      const candidateSlot: TimeSlot = {
        startTime: slotStart.toISOString(),
        endTime: slotEnd.toISOString(),
        formattedDate: formatCandidateSlotDate(slotStart, tz),
        formattedTime: formatCandidateSlotTime(slotStart, tz),
        timezone: tz,
      };

      const isFree = await isSlotAvailable(db, accountId, candidateSlot.startTime, candidateSlot.endTime);
      if (isFree) {
        return await executeMeetingBooking({
          db,
          accountId,
          contactId,
          conversationId,
          qualification,
          state,
          candidateSlot,
          settings,
          contactName,
          tzLabel,
        });
      } else {
        return await offerAlternativeSlots({
          db,
          accountId,
          qualification,
          state,
          messagePrefix: 'That slot was just taken. Here are the next available slots:\n\n',
        });
      }
    }

    // 10C. User provided both Date and Time
    if (nlpResult.hasExplicitDate && nlpResult.hasExplicitTime && nlpResult.date) {
      const start = nlpResult.date;
      const end = new Date(start.getTime() + settings.meeting_duration_minutes * 60 * 1000);
      const candidateSlot: TimeSlot = {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        formattedDate: formatCandidateSlotDate(start, tz),
        formattedTime: formatCandidateSlotTime(start, tz),
        timezone: tz,
      };

      state.available_slots_checked = true;
      const isFree = await isSlotAvailable(db, accountId, candidateSlot.startTime, candidateSlot.endTime);

      if (isFree) {
        state.conversation_stage = 'STAGE_8_CONFIRM_BOOK';
        state.selected_slot = candidateSlot.startTime;
        state.preferred_date = nlpResult.dateStr || null;
        state.preferred_time = nlpResult.timeStr || null;
        state.booking_status = 'offered';

        const notes = serializeStateToNotes(formatLeadSummary(state), state);
        await updateQualificationState(db, qualification.id, {
          state: 'SLOT_SELECTION',
          selected_slot: candidateSlot.startTime,
          proposed_slots: [candidateSlot],
          qualification_notes: notes,
        });

        return {
          text: `Good news! ${candidateSlot.formattedDate} at ${candidateSlot.formattedTime} ${tzLabel} is available for a ${settings.meeting_duration_minutes}-minute discovery call. 🙌\n\nShall I go ahead and book that slot for you?`,
          handoff: false,
          state: 'SLOT_SELECTION',
          leadSummary: formatLeadSummary(state),
        };
      } else {
        return await offerAlternativeSlots({
          db,
          accountId,
          qualification,
          state,
          messagePrefix: `That particular time slot is already booked. Here are the closest available slots with our team:\n\n`,
        });
      }
    }

    // 10D. User provided Date ONLY (no time)
    if (nlpResult.hasExplicitDate && !nlpResult.hasExplicitTime) {
      state.preferred_date = nlpResult.dateStr || null;
      state.conversation_stage = 'STAGE_7_COLLECT_DATETIME';

      const dayLabel = nlpResult.rawMatchedText
        ? nlpResult.rawMatchedText.charAt(0).toUpperCase() + nlpResult.rawMatchedText.slice(1)
        : 'That day';

      const notes = serializeStateToNotes(formatLeadSummary(state), state);
      await updateQualificationState(db, qualification.id, {
        state: 'SLOT_SELECTION',
        qualification_notes: notes,
      });

      return {
        text: `${dayLabel} works! 🙌 What time suits you best? (Our team is available 9:00 AM to 6:00 PM ${tzLabel}).`,
        handoff: false,
        state: 'SLOT_SELECTION',
        leadSummary: formatLeadSummary(state),
      };
    }

    // 10E. User provided Time ONLY (no date)
    if (!nlpResult.hasExplicitDate && nlpResult.hasExplicitTime && nlpResult.timeStr) {
      if (state.preferred_date) {
        const candidateDate = assembleDateTime(state.preferred_date, nlpResult.timeStr);
        const end = new Date(candidateDate.getTime() + settings.meeting_duration_minutes * 60 * 1000);
        const candidateSlot: TimeSlot = {
          startTime: candidateDate.toISOString(),
          endTime: end.toISOString(),
          formattedDate: formatCandidateSlotDate(candidateDate, tz),
          formattedTime: formatCandidateSlotTime(candidateDate, tz),
          timezone: tz,
        };

        const isFree = await isSlotAvailable(db, accountId, candidateSlot.startTime, candidateSlot.endTime);
        if (isFree) {
          state.conversation_stage = 'STAGE_8_CONFIRM_BOOK';
          state.selected_slot = candidateSlot.startTime;
          state.preferred_time = nlpResult.timeStr;
          state.booking_status = 'offered';

          const notes = serializeStateToNotes(formatLeadSummary(state), state);
          await updateQualificationState(db, qualification.id, {
            state: 'SLOT_SELECTION',
            selected_slot: candidateSlot.startTime,
            proposed_slots: [candidateSlot],
            qualification_notes: notes,
          });

          return {
            text: `Good news! ${candidateSlot.formattedDate} at ${candidateSlot.formattedTime} ${tzLabel} is available for a ${settings.meeting_duration_minutes}-minute discovery call. 🙌\n\nShall I confirm this slot for you?`,
            handoff: false,
            state: 'SLOT_SELECTION',
            leadSummary: formatLeadSummary(state),
          };
        } else {
          return await offerAlternativeSlots({
            db,
            accountId,
            qualification,
            state,
            messagePrefix: `That time is already booked. Here are the closest available slots:\n\n`,
          });
        }
      } else {
        state.preferred_time = nlpResult.timeStr;
        const notes = serializeStateToNotes(formatLeadSummary(state), state);
        await updateQualificationState(db, qualification.id, {
          state: 'SLOT_SELECTION',
          qualification_notes: notes,
        });

        return {
          text: `${nlpResult.timeStr} sounds great! Which day works best for your schedule — tomorrow, or another day this week?`,
          handoff: false,
          state: 'SLOT_SELECTION',
          leadSummary: formatLeadSummary(state),
        };
      }
    }

    // 10F. User declined in STAGE_8 or STAGE_7
    if (nlpResult.isNegative || isNegativeResponse(userText)) {
      state.conversation_stage = 'STAGE_7_COLLECT_DATETIME';
      return {
        text: 'No problem at all! What other day or time would work better for your calendar?',
        handoff: false,
        state: 'SLOT_SELECTION',
        leadSummary: formatLeadSummary(state),
      };
    }
  }

  // 12. STAGES 1 THROUGH 5 CONSULTATIVE FLOW

  // Determine current conversational stage based on known facts
  determineNextConsultativeStage(state);

  // 12. Build Consultative System Prompt & Generate Reply with AI Provider
  const promptSystem = buildOpsiysSystemPrompt({
    state,
    contactName,
    basePrompt: config.systemPrompt,
    timezone: tz,
  });

  let text = '';
  let handoff = false;

  try {
    const replyResult = await generateReply({
      config,
      systemPrompt: promptSystem,
      messages,
    });
    text = replyResult?.text || (typeof replyResult === 'string' ? replyResult : '');
    handoff = Boolean(replyResult?.handoff);
  } catch (genErr) {
    console.warn('[opsiys-agent] AI generateReply failed, using consultative fallback:', genErr);
    text = getStageFallbackReply(state);
  }

  // Check if text triggers handoff
  if (text.includes(HANDOFF_SENTINEL)) {
    handoff = true;
  }

  // Update stage based on generation content
  if (handoff) {
    state.conversation_stage = 'HUMAN_HANDOFF';
  } else if (
    text.toLowerCase().includes('discovery call') ||
    text.toLowerCase().includes('open to a short') ||
    text.toLowerCase().includes('would you be open')
  ) {
    state.benefits_explained = true;
    state.conversation_stage = 'STAGE_6_INVITE_MEETING';
  } else if (state.conversation_stage === 'STAGE_1_BUSINESS' && state.business_type) {
    state.conversation_stage = 'STAGE_2_CHALLENGE';
  }

  const dbState = mapStageToDbState(state.conversation_stage);
  const notes = serializeStateToNotes(formatLeadSummary(state), state);

  await updateQualificationState(db, qualification.id, {
    state: dbState,
    business_type: state.business_type,
    requested_service: state.selected_service,
    pain_points: state.primary_challenge,
    qualification_notes: notes,
    message_count: (qualification.message_count || 0) + 1,
  });

  return {
    text: text.replace(HANDOFF_SENTINEL, '').trim(),
    handoff,
    state: dbState,
    leadSummary: formatLeadSummary(state),
  };
}

/**
 * Determine logical next stage in the 8-stage sequence based on what is known.
 */
function determineNextConsultativeStage(state: OpsiysLeadState): void {
  if (state.meeting_interest === 'yes') {
    if (!state.selected_slot) {
      state.conversation_stage = 'STAGE_7_COLLECT_DATETIME';
    } else {
      state.conversation_stage = 'STAGE_8_CONFIRM_BOOK';
    }
    return;
  }

  if (!state.business_type) {
    state.conversation_stage = 'STAGE_1_BUSINESS';
  } else if (!state.primary_challenge) {
    state.conversation_stage = 'STAGE_2_CHALLENGE';
  } else if (!state.selected_service) {
    state.conversation_stage = 'STAGE_4_ASK_SERVICE_INTEREST';
  } else if (!state.benefits_explained) {
    state.conversation_stage = 'STAGE_5_EXPLAIN_BENEFITS';
  } else {
    state.conversation_stage = 'STAGE_6_INVITE_MEETING';
  }
}

/**
 * Build rich consultative OPSIYS system prompt with stage-specific directives.
 */
export function buildOpsiysSystemPrompt(args: {
  state: OpsiysLeadState;
  contactName?: string | null;
  basePrompt?: string | null;
  timezone: string;
}): string {
  const { state, contactName, basePrompt, timezone } = args;

  const promptSections = [
    'You are a smart, friendly, consultative Senior Sales Representative for OPSIYS.',
    'OPSIYS is a leading technology agency specializing in WhatsApp AI Automation, Custom AI Agents, CRM Integrations, Lead Generation Systems, and High-Converting Websites.',
    '',
    `Prospect Name: ${contactName || 'Valued Prospect'}`,
    `Current Stage: ${state.conversation_stage}`,
    `Prospect Stored Context:`,
    `- Business Type: ${state.business_type || 'Unknown yet'}`,
    `- Target Customers: ${state.target_customers || 'Unknown yet'}`,
    `- Primary Goal/Challenge: ${state.primary_challenge || 'Unknown yet'}`,
    `- Service of Interest: ${state.selected_service || 'Not yet selected'}`,
    `- Benefits Explained: ${state.benefits_explained ? 'Yes' : 'No'}`,
    `- Timezone: ${timezone}`,
    '',
    '## CORE CONVERSATIONAL SALES GUIDELINES:',
    '1. CONSULTATIVE, FRIENDLY & HUMAN: Speak like a helpful, senior human sales consultant. Adapt naturally to the prospect\'s language (fluent English or natural Hinglish). Keep emojis tasteful and natural (1-2 per reply, never in every sentence).',
    '2. ONE PRIMARY QUESTION PER MESSAGE: Never overwhelm the prospect with multiple questions. Ask one clear question.',
    '3. ACKNOWLEDGE BEFORE ASKING: Always genuinely acknowledge what the prospect just shared before moving forward.',
    '4. SHORT & READABLE: Keep WhatsApp messages concise (2 to 4 sentences). No walls of text.',
    '5. NEVER REPEAT QUESTIONS: If the prospect has already shared what they do, their challenge, or the service they want, NEVER ask them again. Acknowledge and advance!',
    '6. REALISTIC LANGUAGE ONLY: Never guarantee revenue, specific lead counts, conversions, or savings without evidence.',
    '7. DO NOT INVENT SLOTS OR LINKS: Never fabricate calendar availability or meeting links in your text. The scheduling engine manages slots and bookings.',
    '8. HANDLE QUESTIONS & PRICING HONESTLY: If the prospect asks a question (pricing, timeline, capabilities), answer it clearly first! For pricing: explain our solutions are tailored to their specific workflow/volume, and a customized quote is provided on our discovery call.',
    `9. HUMAN HANDOFF: If the user asks to speak to a human or is frustrated, politely connect them and include '${HANDOFF_SENTINEL}'.`,
    '',
    '## STAGE-SPECIFIC OBJECTIVE FOR THIS TURN:',
  ];

  switch (state.conversation_stage) {
    case 'STAGE_1_BUSINESS':
      promptSections.push(
        'Your goal is Stage 1: Welcome them warmly to OPSIYS and ask what their business does and who their main customers are. (e.g. "Hey! 👋 Welcome to OPSIYS. Before I suggest anything, I\'d love to understand your business a little. What do you do, and who are your main customers?")'
      );
      break;
    case 'STAGE_2_CHALLENGE':
      promptSections.push(
        `Your goal is Stage 2: Acknowledge their business (${state.business_type || 'their business'}) with a genuine, context-specific response. Then ask ONE relevant follow-up question to discover their biggest challenge (e.g. finding leads, slow replies to enquiries, manually following up, or booking appointments).`
      );
      break;
    case 'STAGE_3_RECOMMEND_SERVICE':
    case 'STAGE_4_ASK_SERVICE_INTEREST':
      promptSections.push(
        `Your goal is Stage 3 & 4: Acknowledge their specific challenge (${state.primary_challenge || 'managing repetitive enquiries'}). Introduce ONLY the relevant OPSIYS solution (e.g. WhatsApp AI automation for instant replies & follow-ups) tailored to their business. Do NOT list all services. Then ask which part would make the biggest difference to their business right now.`
      );
      break;
    case 'STAGE_5_EXPLAIN_BENEFITS':
      promptSections.push(
        `Your goal is Stage 5: Explain the practical business outcomes of ${state.selected_service || 'WhatsApp automation'} for their specific business (${state.business_type || 'business'}). Connect the benefit directly to their goal (e.g. replying 24/7 so no leads are lost while busy with clients). Use realistic language.`
      );
      break;
    case 'STAGE_6_INVITE_MEETING':
      promptSections.push(
        `Your goal is Stage 6: The prospect understands the benefits. Offer a low-pressure, friendly discovery call with the OPSIYS team (e.g. "If you'd like, we can explore how this would work for your business specifically. 😊 Would you be open to a short discovery call with the OPSIYS team?"). If the prospect raised objections or asked questions, answer them first!`
      );
      break;
    default:
      promptSections.push('Be helpful, professional, and move the conversation forward naturally.');
  }

  if (basePrompt && basePrompt.trim()) {
    promptSections.push('\n## ACCOUNT DIRECTIVES & KNOWLEDGE:');
    promptSections.push(basePrompt);
  }

  return promptSections.join('\n');
}

/**
 * Fallback messages if AI generation is temporarily unavailable.
 */
function getStageFallbackReply(state: OpsiysLeadState): string {
  switch (state.conversation_stage) {
    case 'STAGE_1_BUSINESS':
      return "Hey! 👋 Welcome to OPSIYS. Before I suggest anything, I'd love to understand your business a little. What do you do, and who are your main customers?";
    case 'STAGE_2_CHALLENGE':
      return `That's great! Helping ${state.business_type || 'clients'} grow is exciting work. 😊 How do you currently get new clients, and what's your biggest challenge — finding leads, following up, or converting enquiries into paying clients?`;
    case 'STAGE_3_RECOMMEND_SERVICE':
    case 'STAGE_4_ASK_SERVICE_INTEREST':
      return "Got it! 😊 If you're spending a lot of time replying to enquiries and chasing leads, our WhatsApp AI agents can handle enquiries, qualify prospects, and follow up automatically.\n\nWhich part would make the biggest difference for your business right now — automating WhatsApp conversations, managing follow-ups, or getting qualified leads?";
    case 'STAGE_5_EXPLAIN_BENEFITS':
    case 'STAGE_6_INVITE_MEETING':
      return `A WhatsApp AI agent would be a great fit for your ${state.business_type || 'business'}! 🚀 It can handle initial enquiries 24/7, qualify leads before you get involved, and follow up automatically so you don't lose potential clients.\n\nWould you be open to a short discovery call with the OPSIYS team to explore how this would work for your business specifically? 😊`;
    default:
      return "Hey! 👋 Thanks for reaching out to OPSIYS. What kind of business are you running, and who do you usually work with?";
  }
}

/**
 * Execute real calendar booking, verify success, and return formatted WhatsApp confirmation.
 */
async function executeMeetingBooking(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId: string;
  qualification: AiLeadQualification;
  state: OpsiysLeadState;
  candidateSlot: TimeSlot;
  settings: { meeting_duration_minutes: number; default_meeting_link: string | null };
  contactName?: string | null;
  tzLabel: string;
}): Promise<OpsiysAgentResult> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    qualification,
    state,
    candidateSlot,
    settings,
    contactName,
    tzLabel,
  } = args;

  const idempotencyKey = `bcast_${conversationId}_${new Date(candidateSlot.startTime).getTime()}`;
  const leadSummaryText = formatLeadSummary(state);

  const bookingRes = await bookMeeting(db, {
    accountId,
    contactId,
    conversationId,
    title: `OPSIYS Discovery: ${contactName || 'Lead'} (${state.selected_service || 'Automation'})`,
    description: `Customer: ${contactName || 'WhatsApp Lead'}\nService: ${state.selected_service || 'General'}\nChallenge: ${state.primary_challenge || 'N/A'}\nBusiness: ${state.business_type || 'N/A'}`,
    serviceRequested: state.selected_service || 'WhatsApp Automation',
    startTime: candidateSlot.startTime,
    endTime: candidateSlot.endTime,
    timezone: candidateSlot.timezone,
    bookingSource: 'whatsapp_ai',
    leadSummary: leadSummaryText,
    idempotencyKey,
  });

  if (bookingRes.success && bookingRes.meeting_id) {
    state.conversation_stage = 'MEETING_BOOKED';
    state.booking_status = 'confirmed';
    state.selected_slot = candidateSlot.startTime;
    state.meeting_link = bookingRes.meeting_link || settings.default_meeting_link || null;

    const notes = serializeStateToNotes(formatLeadSummary(state), state);
    await updateQualificationState(db, qualification.id, {
      state: 'MEETING_BOOKED',
      selected_slot: candidateSlot.startTime,
      meeting_id: bookingRes.meeting_id,
      qualification_notes: notes,
    });

    const confirmationMessage =
      `You're all set! 🎉 *Your discovery call with OPSIYS is confirmed!*\n\n` +
      `📅 *Date:* ${candidateSlot.formattedDate}\n` +
      `🕒 *Time:* ${candidateSlot.formattedTime} ${tzLabel}\n` +
      `⏳ *Duration:* ${settings.meeting_duration_minutes} Minutes\n` +
      (state.meeting_link ? `🔗 *Meeting link:* ${state.meeting_link}\n\n` : '\n') +
      `Looking forward to learning more about your business and exploring how we can help! 🚀`;

    return {
      text: confirmationMessage,
      handoff: false,
      state: 'MEETING_BOOKED',
      bookedMeetingId: bookingRes.meeting_id,
      leadSummary: leadSummaryText,
    };
  }

  return await offerAlternativeSlots({
    db,
    accountId,
    qualification,
    state,
    messagePrefix: 'I was unable to secure that slot. Here are the closest alternative slots with our team:\n\n',
  });
}

/**
 * Fetch real alternative slots from calendar and offer to prospect.
 */
async function offerAlternativeSlots(args: {
  db: SupabaseClient;
  accountId: string;
  qualification: AiLeadQualification;
  state: OpsiysLeadState;
  messagePrefix: string;
}): Promise<OpsiysAgentResult> {
  const { db, accountId, qualification, state, messagePrefix } = args;

  const altSlots = await getAvailableSlots(db, accountId, { limit: 3 });
  const altFormatted = formatSlotsForWhatsApp(altSlots);

  state.conversation_stage = 'STAGE_8_CONFIRM_BOOK';
  state.booking_status = 'offered';
  state.available_slots_checked = true;

  const notes = serializeStateToNotes(formatLeadSummary(state), state);
  await updateQualificationState(db, qualification.id, {
    state: 'SLOT_SELECTION',
    proposed_slots: altSlots,
    qualification_notes: notes,
  });

  return {
    text: `${messagePrefix}${altFormatted}\n\nWhich of these would work for you? (You can also propose another date and time!)`,
    handoff: false,
    state: 'SLOT_SELECTION',
    leadSummary: formatLeadSummary(state),
  };
}

/**
 * Load or create an ai_lead_qualifications record for the conversation.
 */
async function loadOrCreateQualification(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
): Promise<AiLeadQualification> {
  const { data } = await db
    .from('ai_lead_qualifications')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (data) {
    return data as AiLeadQualification;
  }

  const { data: created, error } = await db
    .from('ai_lead_qualifications')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      state: 'NEW_LEAD',
    })
    .select()
    .single();

  if (error || !created) {
    return {
      id: 'temp',
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      state: 'NEW_LEAD',
      business_type: null,
      requested_service: null,
      pain_points: null,
      urgency: null,
      budget: null,
      qualification_notes: null,
      proposed_slots: [],
      selected_slot: null,
      meeting_id: null,
      message_count: 0,
      last_interaction_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  return created as AiLeadQualification;
}

async function updateQualificationState(
  db: SupabaseClient,
  id: string,
  updates: Partial<AiLeadQualification>,
): Promise<void> {
  if (id === 'temp') return;
  await db
    .from('ai_lead_qualifications')
    .update({
      ...updates,
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}

/**
 * Serialize state to human summary and JSON payload stored in qualification_notes.
 */
export function serializeStateToNotes(summary: string, state: OpsiysLeadState): string {
  return `${summary}\n---\n${JSON.stringify(state)}`;
}

/**
 * Deserialize 16-field logical state from qualification_notes.
 */
export function deserializeStateFromNotes(
  notes: string | null,
  qualification: Partial<AiLeadQualification>,
  defaultTimezone: string = 'Asia/Kolkata',
): OpsiysLeadState {
  let parsed: Partial<OpsiysLeadState> = {};
  if (notes && notes.includes('---')) {
    try {
      const jsonPart = notes.substring(notes.indexOf('---') + 3).trim();
      parsed = JSON.parse(jsonPart);
    } catch {
      // Non-fatal JSON parse error
    }
  }

  let stage: ConversationStage = parsed.conversation_stage || 'STAGE_1_BUSINESS';
  if (!parsed.conversation_stage) {
    if (qualification.state === 'MEETING_BOOKED') stage = 'MEETING_BOOKED';
    else if (qualification.state === 'MEETING_CANCELLED') stage = 'MEETING_CANCELLED';
    else if (qualification.state === 'HUMAN_HANDOFF') stage = 'HUMAN_HANDOFF';
    else if (qualification.state === 'SLOT_SELECTION') stage = 'STAGE_7_COLLECT_DATETIME';
    else if (qualification.state === 'MEETING_OFFERED') stage = 'STAGE_6_INVITE_MEETING';
    else if (qualification.state === 'LEAD_QUALIFIED') stage = 'STAGE_5_EXPLAIN_BENEFITS';
    else if (qualification.state === 'REQUIREMENT_DISCOVERY') stage = 'STAGE_2_CHALLENGE';
    else stage = 'STAGE_1_BUSINESS';
  }

  return {
    business_type: parsed.business_type || qualification.business_type || null,
    target_customers: parsed.target_customers || null,
    business_goal: parsed.business_goal || null,
    primary_challenge: parsed.primary_challenge || qualification.pain_points || null,
    recommended_services: parsed.recommended_services || [],
    selected_service: parsed.selected_service || qualification.requested_service || null,
    benefits_explained: parsed.benefits_explained || false,
    meeting_interest: parsed.meeting_interest || null,
    preferred_date: parsed.preferred_date || null,
    preferred_time: parsed.preferred_time || null,
    timezone: parsed.timezone || defaultTimezone,
    available_slots_checked: parsed.available_slots_checked || false,
    selected_slot: parsed.selected_slot || qualification.selected_slot || null,
    booking_status: parsed.booking_status || (qualification.state === 'MEETING_BOOKED' ? 'confirmed' : 'none'),
    meeting_link: parsed.meeting_link || null,
    conversation_stage: stage,
  };
}

export function mapStageToDbState(stage: ConversationStage): QualificationState {
  switch (stage) {
    case 'STAGE_1_BUSINESS':
      return 'GREETING';
    case 'STAGE_2_CHALLENGE':
    case 'STAGE_3_RECOMMEND_SERVICE':
    case 'STAGE_4_ASK_SERVICE_INTEREST':
      return 'REQUIREMENT_DISCOVERY';
    case 'STAGE_5_EXPLAIN_BENEFITS':
      return 'LEAD_QUALIFIED';
    case 'STAGE_6_INVITE_MEETING':
      return 'MEETING_OFFERED';
    case 'STAGE_7_COLLECT_DATETIME':
    case 'STAGE_8_CONFIRM_BOOK':
      return 'SLOT_SELECTION';
    case 'MEETING_BOOKED':
      return 'MEETING_BOOKED';
    case 'MEETING_CANCELLED':
      return 'MEETING_CANCELLED';
    case 'OPT_OUT':
    case 'HUMAN_HANDOFF':
      return 'HUMAN_HANDOFF';
    default:
      return 'REQUIREMENT_DISCOVERY';
  }
}

/**
 * Extract structured parameters from prospect messages.
 */
export function extractProspectInformation(
  text: string,
  current: OpsiysLeadState,
): Partial<OpsiysLeadState> {
  const lower = text.toLowerCase();
  const updates: Partial<OpsiysLeadState> = {};

  // Business Types
  if (/(business|executive|life|mindset|career|fitness)\s*coach(ing)?/i.test(lower)) {
    updates.business_type = 'Business Coaching';
  } else if (/real estate|realtor|property|builder|broker/i.test(lower)) {
    updates.business_type = 'Real Estate';
  } else if (/e-?commerce|shopify|online store|retail|products/i.test(lower)) {
    updates.business_type = 'E-commerce';
  } else if (/clinic|hospital|doctor|dentist|dental|health(care)?/i.test(lower)) {
    updates.business_type = 'Healthcare / Clinic';
  } else if (/agency|consulting|consultant|marketing agency|firm|b2b/i.test(lower)) {
    updates.business_type = 'Consulting / Agency';
  } else if (/edtech|course|institute|academy|tutor|education/i.test(lower)) {
    updates.business_type = 'Education / Training';
  } else if (/restaurant|cafe|hotel|hospitality|food/i.test(lower)) {
    updates.business_type = 'Hospitality / Restaurant';
  } else if (/salon|spa|wellness|beauty/i.test(lower)) {
    updates.business_type = 'Salon & Spa';
  } else if (/saas|software|tech(nology)?|startup/i.test(lower)) {
    updates.business_type = 'SaaS / Tech';
  } else {
    const bizMatch = text.match(/\b(?:i am|i'm|we are|we run|our business is|i run)(?: a| an)?\s+([a-zA-Z\s]{3,30})/i);
    if (bizMatch && !/looking|interested|trying|here/i.test(bizMatch[1])) {
      updates.business_type = bizMatch[1].trim();
    }
  }

  // Target Customers
  if (/b2b|businesses|founders|owners|ceos|startups/i.test(lower)) {
    updates.target_customers = 'B2B / Founders';
  } else if (/students|learners|kids|parents/i.test(lower)) {
    updates.target_customers = 'Students / Learners';
  } else if (/patients/i.test(lower)) {
    updates.target_customers = 'Patients';
  } else if (/home buyers|investors|tenants/i.test(lower)) {
    updates.target_customers = 'Home Buyers / Investors';
  } else if (/consumers|shoppers|individuals|clients/i.test(lower)) {
    updates.target_customers = 'Consumers / Clients';
  }

  // Primary Challenge & Goals
  if (/follow(ing)?\s*up|chasing leads|delayed response|time to reply|takes too much time/i.test(lower)) {
    updates.primary_challenge = 'Slow lead follow-ups & manual replies';
  } else if (/missed calls|missed appointments|no shows|scheduling/i.test(lower)) {
    updates.primary_challenge = 'Scheduling & missed appointments';
  } else if (/finding leads|get leads|lead gen|more clients|acquisition/i.test(lower)) {
    updates.primary_challenge = 'Lead generation & client acquisition';
  } else if (/repetitive|manual work|admin|data entry/i.test(lower)) {
    updates.primary_challenge = 'Repetitive manual administrative work';
  } else if (/convert(ing)?|sales conversion|closing/i.test(lower)) {
    updates.primary_challenge = 'Converting enquiries into paying clients';
  }

  // Service Interest
  if (/whatsapp|chat\s*bot|chatgpt\s*for\s*whatsapp/i.test(lower)) {
    updates.selected_service = 'WhatsApp Automation';
  } else if (/ai agent|custom ai|customer support automation|support bot/i.test(lower)) {
    updates.selected_service = 'AI Customer Support & Agents';
  } else if (/crm|hubspot|salesforce|lead management|pipeline/i.test(lower)) {
    updates.selected_service = 'CRM & Lead Management';
  } else if (/lead gen|generation|lead qualification/i.test(lower)) {
    updates.selected_service = 'Lead Generation & Qualification';
  } else if (/web(site)?|landing page|app development/i.test(lower)) {
    updates.selected_service = 'Website & Application Development';
  } else if (/email|marketing automation|drip/i.test(lower)) {
    updates.selected_service = 'Email & Marketing Automation';
  }

  // Meeting interest
  if (/book|schedule|call|demo|meet|yes|sure|sounds good|let'?s do it/i.test(lower)) {
    if (current.conversation_stage === 'STAGE_6_INVITE_MEETING' || /book|schedule|call|demo/i.test(lower)) {
      updates.meeting_interest = 'yes';
    }
  } else if (/(no|not now|not right now|not interested|later|busy|skip)\b/i.test(lower)) {
    if (current.conversation_stage === 'STAGE_6_INVITE_MEETING') {
      updates.meeting_interest = 'no';
    }
  }

  return updates;
}

export function formatLeadSummary(s: Partial<OpsiysLeadState>): string {
  const parts: string[] = [];
  if (s.business_type) parts.push(`Business: ${s.business_type}`);
  if (s.selected_service) parts.push(`Service: ${s.selected_service}`);
  if (s.primary_challenge) parts.push(`Challenge: ${s.primary_challenge}`);
  if (s.conversation_stage) parts.push(`Stage: ${s.conversation_stage}`);
  return parts.length > 0 ? parts.join(' | ') : 'General Inbound Lead';
}

function formatCandidateSlotDate(d: Date, tz: string): string {
  try {
    return d.toLocaleDateString('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
}

function formatCandidateSlotTime(d: Date, tz: string): string {
  try {
    return d.toLocaleTimeString('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}

function formatTimezoneLabel(tz: string): string {
  if (tz === 'Asia/Kolkata') return 'IST';
  if (tz === 'America/New_York') return 'EST';
  if (tz === 'America/Los_Angeles') return 'PST';
  if (tz === 'Europe/London') return 'BST/GMT';
  if (tz === 'Asia/Dubai') return 'GST';
  return tz;
}

function assembleDateTime(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}
