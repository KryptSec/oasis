import { Command } from 'commander';
import ora from 'ora';
import { colors, status } from '../lib/display.js';
import { setApiKey } from '../lib/config.js';
import open from 'open';

const KRYPTSEC_URL = process.env.OASIS_WEB_URL || 'https://kryptsec.com';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  user_info?: {
    id: string;
    email: string;
    display_name?: string;
  };
  error?: string;
  error_description?: string;
}

export const loginCommand = new Command('login')
  .description('Authenticate with Kryptsec for verified runs and leaderboard submissions')
  .option('--no-browser', 'Do not open browser automatically')
  .action(async (options) => {
    console.log();
    console.log(colors.cyan.bold('🔐 OASIS Authentication'));
    console.log(colors.gray('Logging in to Kryptsec...'));
    console.log();

    try {
      // Step 1: Request device code
      const spinner = ora({
        text: 'Requesting authorization code...',
        prefixText: status.info,
      }).start();

      const deviceRes = await fetch(`${KRYPTSEC_URL}/api/oasis/device/code`, {
        method: 'POST',
      });

      if (!deviceRes.ok) {
        spinner.fail('Failed to request authorization code');
        console.error(colors.red(`\n  Server error: ${deviceRes.status}`));
        process.exit(1);
      }

      const deviceData = await deviceRes.json() as DeviceCodeResponse;
      spinner.succeed('Authorization code generated');

      // Step 2: Display instructions to user
      console.log();
      console.log(colors.cyan.bold('  To complete authentication:'));
      console.log();
      console.log(colors.white(`    1. Visit: ${colors.cyan.underline(deviceData.verification_uri)}`));
      console.log();
      console.log(colors.white(`    2. Enter code: ${colors.yellow.bold(deviceData.user_code)}`));
      console.log();
      console.log(colors.gray(`  Code expires in ${Math.floor(deviceData.expires_in / 60)} minutes`));
      console.log();

      // Step 3: Open browser automatically (unless --no-browser)
      if (options.browser !== false) {
        try {
          await open(deviceData.verification_uri_complete);
          console.log(colors.gray('  ✓ Opened browser automatically'));
          console.log();
        } catch (error) {
          console.log(colors.gray('  ℹ Could not open browser automatically'));
          console.log();
        }
      }

      // Step 4: Poll for authorization
      const pollSpinner = ora({
        text: 'Waiting for authorization...',
        prefixText: status.info,
      }).start();

      const pollInterval = (deviceData.interval || 5) * 1000; // Convert to ms
      const maxAttempts = Math.floor(deviceData.expires_in / (deviceData.interval || 5));
      let token: TokenResponse | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        const tokenRes = await fetch(`${KRYPTSEC_URL}/api/oasis/device/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceData.device_code }),
        });

        const tokenData = await tokenRes.json() as TokenResponse;

        // Success - got access token
        if (tokenData.access_token) {
          token = tokenData;
          break;
        }

        // Still waiting for user
        if (tokenData.error === 'authorization_pending') {
          continue;
        }

        // Other error
        if (tokenData.error) {
          pollSpinner.fail(tokenData.error_description || tokenData.error);
          process.exit(1);
        }
      }

      if (!token || !token.access_token) {
        pollSpinner.fail('Authorization timeout - code expired');
        console.log();
        console.log(colors.gray('  Please run `oasis login` again to get a new code'));
        process.exit(1);
      }

      pollSpinner.succeed('Authorization successful!');

      // Step 5: Store token
      setApiKey('oasis', token.access_token);

      // Step 6: Display success
      console.log();
      console.log(colors.green.bold('  ✓ Successfully logged in!'));
      console.log();
      console.log(colors.white(`  Account: ${colors.cyan(token.user_info?.email || 'Unknown')}`));
      if (token.user_info?.display_name) {
        console.log(colors.white(`  Name: ${token.user_info.display_name}`));
      }
      console.log(colors.gray(`  Token expires in ${Math.floor((token.expires_in || 0) / 86400)} days`));
      console.log();
      console.log(colors.gray('  You can now run verified benchmarks:'));
      console.log(colors.gray(`    ${colors.white('oasis run --verified -c gatekeeper -m claude-sonnet-4-20250514')}`));
      console.log();

    } catch (error) {
      console.error(colors.red('\n  Failed to authenticate'));
      console.error(colors.gray(`  ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });
