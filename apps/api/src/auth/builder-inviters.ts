const DEFAULT_BUILDER_INVITER_EMAILS = [
  'golfergeek@orchestratorai.io',
  'bernierethanw@gmail.com',
  'dan.kight@gmail.com',
];

export function getBuilderInviterEmails(): string[] {
  const configured = (process.env.DIVINR_BUILDER_INVITER_EMAILS ?? '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(email => email.length > 0);
  return Array.from(new Set([
    ...DEFAULT_BUILDER_INVITER_EMAILS,
    ...configured,
  ]));
}
