import { redactOltCli } from './redact-olt-cli';

describe('OLT credential redaction', () => {
  it.each([
    'password PRIVATE', 'password "PRIVATE"', "password 'PRIVATE'", 'username PRIVATE',
    'http://user:PRIVATE@acs.test/', 'https://acs.test/?token=PRIVATE', 'external error contains PRIVATE',
  ])('redacts %s', input => expect(redactOltCli(input, ['PRIVATE'])).not.toContain('PRIVATE'));
  it('also removes URL encoded known secrets without changing the executable input', () => {
    const command = 'external ' + encodeURIComponent('p@ss!');
    expect(redactOltCli(command, ['p@ss!'])).toBe('external ***');
    expect(command).toContain('p%40ss!');
  });
});
