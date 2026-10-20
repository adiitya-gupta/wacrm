/**
 * Natural language date, time, and intent parser for WhatsApp conversations.
 * Handles Indian and international date/time formats, relative offsets, and timezones.
 */

export interface ParsedDateTimeResult {
  hasDateTime: boolean;
  hasExplicitDate: boolean;
  hasExplicitTime: boolean;
  date?: Date;
  dateStr?: string; // YYYY-MM-DD
  timeStr?: string; // HH:mm
  isoString?: string;
  confidence: number;
  timezone?: string;
  rawMatchedText?: string;
  isAffirmative: boolean;
  isNegative: boolean;
  isCancellation: boolean;
  isReschedule: boolean;
  selectedOptionIndex?: number; // if user said "option 1", "first one", etc.
}

const AFFIRMATIVE_REGEX =
  /\b(yes|yeah|yup|sure|ok|okay|sounds good|perfect|works for me|that works|let'?s do (it|that)|book it|confirm(ed)?|great|done|absolutely|definitely|certainly)\b/i;

const NEGATIVE_REGEX =
  /\b(no|nope|not really|not right now|not now|can'?t|cannot|busy|not free|unavailable|skip|later|not interested|decline)\b/i;

const CANCELLATION_REGEX =
  /\b(cancel(l?ed|l?ing)?|call off|drop (the call|the meeting)|don'?t want (a|the) (call|meeting))\b/i;

const RESCHEDULE_REGEX =
  /\b(reschedule|postpone|change (the )?(time|date|slot)|move (it )?(to|the)|another (time|day|slot)|different time)\b/i;

const OPTION_SELECTION_REGEX =
  /\b(?:option|slot|choice|number|#)?\s*([1-5])\b|\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\s*(?:one|option|slot)?\b/i;

const TIMEZONE_MAP: Record<string, string> = {
  ist: 'Asia/Kolkata',
  'india time': 'Asia/Kolkata',
  est: 'America/New_York',
  edt: 'America/New_York',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pacific: 'America/Los_Angeles',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  gmt: 'Europe/London',
  utc: 'UTC',
  bst: 'Europe/London',
  dubai: 'Asia/Dubai',
  gst: 'Asia/Dubai',
  singapore: 'Asia/Singapore',
  sgt: 'Asia/Singapore',
};

/**
 * Parse an incoming text for booking intents, date/time suggestions, and options.
 */
export function parseNaturalDateTime(
  text: string,
  referenceDate: Date = new Date(),
  defaultTimezone: string = 'Asia/Kolkata',
): ParsedDateTimeResult {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  const isAffirmative = AFFIRMATIVE_REGEX.test(lower);
  const isNegative = NEGATIVE_REGEX.test(lower) && !isAffirmative;
  const isCancellation = CANCELLATION_REGEX.test(lower);
  const isReschedule = RESCHEDULE_REGEX.test(lower);

  // Check for option index
  let selectedOptionIndex: number | undefined;
  const optMatch = lower.match(OPTION_SELECTION_REGEX);
  if (optMatch) {
    if (optMatch[1]) {
      selectedOptionIndex = parseInt(optMatch[1], 10) - 1;
    } else if (optMatch[2]) {
      const ord = optMatch[2].toLowerCase();
      if (ord.startsWith('first') || ord === '1st') selectedOptionIndex = 0;
      else if (ord.startsWith('second') || ord === '2nd') selectedOptionIndex = 1;
      else if (ord.startsWith('third') || ord === '3rd') selectedOptionIndex = 2;
      else if (ord.startsWith('fourth') || ord === '4th') selectedOptionIndex = 3;
      else if (ord.startsWith('fifth') || ord === '5th') selectedOptionIndex = 4;
    }
  }

  // Detect timezone
  let detectedTz = defaultTimezone;
  for (const [key, tz] of Object.entries(TIMEZONE_MAP)) {
    const rx = new RegExp(`\\b${key}\\b`, 'i');
    if (rx.test(lower)) {
      detectedTz = tz;
      break;
    }
  }

  // Parse Date Component
  const parsedDate = parseDateComponent(lower, referenceDate);
  const parsedTime = parseTimeComponent(lower);

  if (!parsedDate && !parsedTime) {
    return {
      hasDateTime: false,
      hasExplicitDate: false,
      hasExplicitTime: false,
      confidence: 0,
      isAffirmative,
      isNegative,
      isCancellation,
      isReschedule,
      selectedOptionIndex,
      timezone: detectedTz,
    };
  }

  // Assemble candidate Date
  const targetDate = parsedDate || new Date(referenceDate);
  const hours = parsedTime ? parsedTime.hours : 15; // default 3 PM if date only
  const minutes = parsedTime ? parsedTime.minutes : 0;

  targetDate.setHours(hours, minutes, 0, 0);

  // If time specified without date and it's already in the past today, advance to tomorrow
  if (!parsedDate && parsedTime && targetDate.getTime() < referenceDate.getTime()) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const hh = String(hours).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');

  return {
    hasDateTime: true,
    hasExplicitDate: Boolean(parsedDate),
    hasExplicitTime: Boolean(parsedTime),
    date: targetDate,
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${min}`,
    isoString: targetDate.toISOString(),
    confidence: parsedDate && parsedTime ? 0.95 : 0.75,
    timezone: detectedTz,
    rawMatchedText: trimmed,
    isAffirmative,
    isNegative,
    isCancellation,
    isReschedule,
    selectedOptionIndex,
  };
}

function parseDateComponent(text: string, ref: Date): Date | null {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);

  if (/\btoday\b/i.test(text)) {
    return d;
  }
  if (/\bday after tomorrow\b/i.test(text)) {
    d.setDate(d.getDate() + 2);
    return d;
  }
  if (/\btomorrow\b/i.test(text)) {
    d.setDate(d.getDate() + 1);
    return d;
  }

  // Weekdays: "on monday", "next friday", "this wednesday"
  const weekdays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  for (let i = 0; i < weekdays.length; i++) {
    const rx = new RegExp(`\\b(this|next)?\\s*${weekdays[i]}\\b`, 'i');
    const match = text.match(rx);
    if (match) {
      const currentDay = ref.getDay();
      let diff = i - currentDay;
      if (diff <= 0) diff += 7; // always future
      if (match[1] && match[1].toLowerCase() === 'next') {
        diff += 7;
      }
      d.setDate(d.getDate() + diff);
      return d;
    }
  }

  // Explicit dates: "25th Oct", "October 25", "25/10", "2026-10-25"
  const monthNames = [
    'january|jan',
    'february|feb',
    'march|mar',
    'april|apr',
    'may',
    'june|jun',
    'july|jul',
    'august|aug',
    'september|sep|sept',
    'october|oct',
    'november|nov',
    'december|dec',
  ];

  for (let m = 0; m < monthNames.length; m++) {
    // "20th Oct" or "20 Oct"
    const rx1 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames[m]})\\b`, 'i');
    const m1 = text.match(rx1);
    if (m1) {
      const day = parseInt(m1[1], 10);
      d.setMonth(m, day);
      if (d.getTime() < ref.getTime()) d.setFullYear(d.getFullYear() + 1);
      return d;
    }

    // "Oct 20" or "October 20th"
    const rx2 = new RegExp(`\\b(${monthNames[m]})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
    const m2 = text.match(rx2);
    if (m2) {
      const day = parseInt(m2[2], 10);
      d.setMonth(m, day);
      if (d.getTime() < ref.getTime()) d.setFullYear(d.getFullYear() + 1);
      return d;
    }
  }

  // Numeric: DD/MM or DD-MM or YYYY-MM-DD
  const isoMatch = text.match(/\b(202\d)-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    return new Date(year, month, day);
  }

  const slashMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](202\d|\d{2}))?\b/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1;
    let year = slashMatch[3] ? parseInt(slashMatch[3], 10) : ref.getFullYear();
    if (year < 100) year += 2000;
    d.setFullYear(year, month, day);
    return d;
  }

  return null;
}

function parseTimeComponent(text: string): { hours: number; minutes: number } | null {
  // "3:30 PM", "3:30pm", "15:00", "3 PM", "3pm", "11 am"
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (timeMatch) {
    const rawHours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const modifier = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

    if (modifier || (timeMatch[2] && rawHours <= 24)) {
      let hours = rawHours;
      if (modifier === 'pm' && hours < 12) hours += 12;
      if (modifier === 'am' && hours === 12) hours = 0;
      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        return { hours, minutes };
      }
    }
  }

  // Period keywords: "in the morning", "afternoon", "evening"
  if (/\bmorning\b/i.test(text)) {
    return { hours: 10, minutes: 0 };
  }
  if (/\bafternoon\b/i.test(text)) {
    return { hours: 14, minutes: 30 };
  }
  if (/\bevening\b/i.test(text)) {
    return { hours: 17, minutes: 0 };
  }
  if (/\bnoon\b/i.test(text) || /\blunch\b/i.test(text)) {
    return { hours: 12, minutes: 0 };
  }

  return null;
}

export function isAffirmativeResponse(text: string): boolean {
  return AFFIRMATIVE_REGEX.test(text.trim().toLowerCase());
}

export function isNegativeResponse(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return NEGATIVE_REGEX.test(lower) && !AFFIRMATIVE_REGEX.test(lower);
}

export function isCancellationRequest(text: string): boolean {
  return CANCELLATION_REGEX.test(text.trim().toLowerCase());
}

export function isRescheduleRequest(text: string): boolean {
  return RESCHEDULE_REGEX.test(text.trim().toLowerCase());
}

export function parseLeadTimezone(text: string): string | null {
  const lower = text.trim().toLowerCase();
  for (const [key, tz] of Object.entries(TIMEZONE_MAP)) {
    const rx = new RegExp(`\\b${key}\\b`, 'i');
    if (rx.test(lower)) {
      return tz;
    }
  }
  return null;
}

export function extractTimezoneOffsetMinutes(timezone: string): number {
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    return Math.round((tzDate.getTime() - utcDate.getTime()) / (60 * 1000));
  } catch {
    return 330; // default Asia/Kolkata
  }
}

export function parseOptionSelection<T extends { formattedTime?: string }>(
  text: string,
  options: T[],
): T | null {
  const res = parseNaturalDateTime(text);
  if (res.selectedOptionIndex !== undefined && options[res.selectedOptionIndex]) {
    return options[res.selectedOptionIndex];
  }

  // Check if text mentions the time of one of the options
  const lower = text.toLowerCase();
  for (const opt of options) {
    if (opt.formattedTime && lower.includes(opt.formattedTime.toLowerCase())) {
      return opt;
    }
  }

  return null;
}

export function parseNaturalLanguageDateTime(
  text: string,
  options?: { referenceDate?: Date; timezone?: string },
): { date: Date; hasTime: boolean; confidence: number } | null {
  const res = parseNaturalDateTime(text, options?.referenceDate, options?.timezone);
  if (!res.hasDateTime || !res.date) return null;
  return {
    date: res.date,
    hasTime: Boolean(res.timeStr),
    confidence: res.confidence,
  };
}
