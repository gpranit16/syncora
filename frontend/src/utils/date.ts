export const parseSafeDate = (dateVal: string | Date | undefined | null): Date => {
  if (!dateVal) return new Date();
  if (dateVal instanceof Date) return dateVal;
  
  let str = String(dateVal).trim();
  // If it's a MySQL format string like "2026-09-12 10:32:53", convert to ISO
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
    str = str.replace(' ', 'T');
  }
  if (!str.endsWith('Z') && !/[+-]\d{2}(:?\d{2})?$/.test(str)) {
    str += 'Z';
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date(dateVal) : parsed;
};

export const formatMessageTimestamp = (dateVal: string | Date | undefined | null): string => {
  const d = parseSafeDate(dateVal);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1 && diffMinutes >= 0) {
    return 'Just now';
  }
  if (diffMinutes < 60 && diffMinutes > 0) {
    return `${diffMinutes}m ago`;
  }

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  if (isToday) {
    return `Today at ${timeStr}`;
  }
  if (isYesterday) {
    return `Yesterday at ${timeStr}`;
  }

  const isThisYear = d.getFullYear() === now.getFullYear();
  const dateStr = d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
  });
  return `${dateStr} at ${timeStr}`;
};
