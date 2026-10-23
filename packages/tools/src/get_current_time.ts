import { AgentError, defineTool } from '@node-agent/core';
import { z } from 'zod';

export type CurrentTimeResponse = {
  timezone: string;
  iso: string;
  weekday: string;
  utcOffset: string;
};

export const getCurrentTimeTool = defineTool({
  name: 'get_current_time',
  description:
    'Returns the current date and time. Use this whenever the answer depends on the current ' +
    'time, date or weekday, because you cannot know it yourself. Optionally pass an IANA ' +
    'timezone to get the time there; defaults to UTC.',
  input: z.object({
    timezone: z
      .string()
      .describe(
        'IANA timezone name, e.g. "Europe/Istanbul" or "America/New_York". Defaults to UTC.',
      )
      .optional(),
  }),
  async execute(input): Promise<CurrentTimeResponse> {
    const timezone = input.timezone || 'UTC';

    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        weekday: 'long',
        timeZoneName: 'longOffset',
      });
    } catch (err) {
      if (err instanceof RangeError) {
        throw new AgentError(
          `Invalid timezone: ${timezone}. Use an IANA name such as "Europe/Berlin" or "UTC".`,
          'invalid_timezone',
          { cause: err },
        );
      }
      throw err;
    }

    const parts = formatter.formatToParts(new Date());
    const partsMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    // longOffset renders "GMT+03:00", and plain "GMT" for UTC.
    const utcOffset = partsMap.timeZoneName?.replace('GMT', '') || '+00:00';

    return {
      timezone: timezone,
      iso: `${partsMap.year}-${partsMap.month}-${partsMap.day}T${partsMap.hour}:${partsMap.minute}:${partsMap.second}${utcOffset}`,
      weekday: partsMap.weekday ?? '',
      utcOffset,
    };
  },
});
