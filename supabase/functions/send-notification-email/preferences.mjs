export function emailAllowed(member, preferences, type, targetPage) {
  if (!member || member.program_status === 'inactive' || preferences?.email_enabled === false) return false;
  if (type === 'announcement' && preferences?.announcement_email_enabled === false) return false;
  if (type === 'resource' && preferences?.resource_email_enabled === false) return false;
  if ((['one_on_one','event'].includes(type) || ['oneOnOnes','calendar'].includes(targetPage)) && preferences?.meeting_email_enabled === false) return false;
  return true;
}

export function staffNotificationCategory(notification) {
  const key = String(notification?.dedupe_key || '').toLowerCase();
  const type = String(notification?.notification_type || '').toLowerCase();
  if (key.startsWith('point-') || type === 'points') return 'points';
  if (key.startsWith('one-on-one-') || ['one_on_one','event'].includes(type)) return 'meetings';
  if (key.startsWith('resume-') || type === 'resume') return 'resumes';
  if (key.startsWith('excuse-') || type === 'excuse') return 'excuses';
  if (key.startsWith('birthday:') || type === 'birthday') return 'birthdays';
  return 'portal';
}

export function staffEmailAllowed(preferences, notification) {
  return preferences?.email_enabled !== false && preferences?.[`${staffNotificationCategory(notification)}_email_enabled`] !== false;
}
