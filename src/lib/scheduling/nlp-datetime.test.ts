import { describe, expect, it } from 'vitest';
import {
  parseNaturalLanguageDateTime,
  parseOptionSelection,
  isAffirmativeResponse,
  isNegativeResponse,
  isRescheduleRequest,
  isCancellationRequest,
  parseLeadTimezone,
  extractTimezoneOffsetMinutes,
} from './nlp-datetime';

describe('NLP Date and Time Parsing', () => {
  const referenceTime = new Date('2026-10-20T10:00:00.000Z'); // Tuesday 10am UTC

  it('correctly parses "tomorrow at 3pm"', () => {
    const result = parseNaturalLanguageDateTime('Can we do tomorrow at 3pm?', {
      referenceDate: referenceTime,
      timezone: 'UTC',
    });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.date.getHours()).toBe(15);
      expect(result.date.getMinutes()).toBe(0);
      expect(result.hasTime).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    }
  });

  it('correctly parses "next Monday at 11:30 AM"', () => {
    const result = parseNaturalLanguageDateTime('How about next Monday at 11:30 AM?', {
      referenceDate: referenceTime,
      timezone: 'UTC',
    });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.date.getHours()).toBe(11);
      expect(result.date.getMinutes()).toBe(30);
      expect(result.hasTime).toBe(true);
    }
  });

  it('correctly parses relative day like "friday 4 pm"', () => {
    const result = parseNaturalLanguageDateTime('Friday 4 pm works for me', {
      referenceDate: referenceTime,
      timezone: 'UTC',
    });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.date.getHours()).toBe(16);
      expect(result.date.getMinutes()).toBe(0);
    }
  });

  it('returns null for messages with no temporal expressions', () => {
    const result = parseNaturalLanguageDateTime('I need WhatsApp automation for my business', {
      referenceDate: referenceTime,
    });
    expect(result).toBeNull();
  });
});

describe('Option Selection Matching', () => {
  const slots = [
    {
      startTime: '2026-10-21T10:00:00Z',
      endTime: '2026-10-21T10:15:00Z',
      formattedDate: 'Wednesday, Oct 21',
      formattedTime: '3:30 PM',
      timezone: 'Asia/Kolkata',
    },
    {
      startTime: '2026-10-21T11:00:00Z',
      endTime: '2026-10-21T11:15:00Z',
      formattedDate: 'Wednesday, Oct 21',
      formattedTime: '4:30 PM',
      timezone: 'Asia/Kolkata',
    },
    {
      startTime: '2026-10-22T09:00:00Z',
      endTime: '2026-10-22T09:15:00Z',
      formattedDate: 'Thursday, Oct 22',
      formattedTime: '2:30 PM',
      timezone: 'Asia/Kolkata',
    },
  ];

  it('matches numerical option "1" or "option 1"', () => {
    expect(parseOptionSelection('1', slots)).toBe(slots[0]);
    expect(parseOptionSelection('Option 1 please', slots)).toBe(slots[0]);
    expect(parseOptionSelection('slot 2', slots)).toBe(slots[1]);
    expect(parseOptionSelection('3', slots)).toBe(slots[2]);
  });

  it('matches ordinal words "first" and "second"', () => {
    expect(parseOptionSelection('the first one works best', slots)).toBe(slots[0]);
    expect(parseOptionSelection('second slot', slots)).toBe(slots[1]);
  });

  it('matches specific time mentioned in the text', () => {
    expect(parseOptionSelection('4:30 PM is great', slots)).toBe(slots[1]);
  });

  it('returns null when text does not match any slot', () => {
    expect(parseOptionSelection('What is your pricing?', slots)).toBeNull();
  });
});

describe('Affirmative and Negative Intent Recognition', () => {
  it('identifies affirmative statements', () => {
    expect(isAffirmativeResponse('yes')).toBe(true);
    expect(isAffirmativeResponse('yes, that works for me')).toBe(true);
    expect(isAffirmativeResponse('sure, let us do it')).toBe(true);
    expect(isAffirmativeResponse('sounds good')).toBe(true);
    expect(isAffirmativeResponse('perfect, book it')).toBe(true);
    expect(isAffirmativeResponse('absolutely')).toBe(true);
  });

  it('identifies negative statements', () => {
    expect(isNegativeResponse('no')).toBe(true);
    expect(isNegativeResponse('not interested')).toBe(true);
    expect(isNegativeResponse('nope')).toBe(true);
    expect(isNegativeResponse('I cannot make it')).toBe(true);
  });

  it('distinguishes between intent and ordinary inquiry', () => {
    expect(isAffirmativeResponse('How does WhatsApp automation work?')).toBe(false);
    expect(isNegativeResponse('What time is the call?')).toBe(false);
  });
});

describe('Reschedule and Cancellation Intent Recognition', () => {
  it('detects reschedule requests', () => {
    expect(isRescheduleRequest('Can we reschedule our meeting?')).toBe(true);
    expect(isRescheduleRequest('I need to change the time of our call')).toBe(true);
    expect(isRescheduleRequest('Can we postpone to next week?')).toBe(true);
    expect(isRescheduleRequest('I want to move it to tomorrow')).toBe(true);
  });

  it('detects cancellation requests', () => {
    expect(isCancellationRequest('Please cancel my appointment')).toBe(true);
    expect(isCancellationRequest('I need to cancel the meeting')).toBe(true);
    expect(isCancellationRequest('Cannot make it, please cancel')).toBe(true);
  });

  it('does not trigger on regular qualification messages', () => {
    expect(isRescheduleRequest('We want to move our CRM to WhatsApp')).toBe(false);
    expect(isCancellationRequest('We want to reduce our customer drop-offs')).toBe(false);
  });
});

describe('Timezone Parsing and Offset Handling', () => {
  it('extracts known timezones from natural text', () => {
    expect(parseLeadTimezone('I am in India, IST time')).toBe('Asia/Kolkata');
    expect(parseLeadTimezone('Available at 3pm EST')).toBe('America/New_York');
    expect(parseLeadTimezone('Pacific time works best')).toBe('America/Los_Angeles');
    expect(parseLeadTimezone('GMT afternoon')).toBe('Europe/London');
    expect(parseLeadTimezone('Dubai time (GST)')).toBe('Asia/Dubai');
    expect(parseLeadTimezone('Singapore')).toBe('Asia/Singapore');
  });

  it('computes timezone offset correctly', () => {
    // Asia/Kolkata is UTC+5:30 -> 330 minutes
    const offset = extractTimezoneOffsetMinutes('Asia/Kolkata');
    expect(offset).toBe(330);
  });
});
