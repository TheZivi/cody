# Cody Bot

This repository contains a Puppeteer script for automating user or guest registration on sites using the Cody chat software.

## Usage

```
npm install puppeteer-extra puppeteer-extra-plugin-stealth inquirer @zennolab_com/capmonstercloud-client
node registration_bot.js
```

The script prompts for:

- **site**: The full URL of the Cody installation.
- **cf_clearance**: Your Cloudflare clearance cookie value.
- **mode**: Choose `account` for full registration or `guest` to register a guest user.
  In guest mode the script triggers `getGuestLogin`, fills the guest form,
  solves the reCAPTCHA using the `recaptKey` variable and submits via
  `sendGuestLogin`.
- **skipCaptcha**: Set to `yes` if you want to skip solving reCAPTCHA.
- **sendMessages**: Set to `yes` to send chat messages after registering.
- If the page scripts are not fully loaded, the bot clicks the registration button directly as a fallback.
- **messageText**: The text to send repeatedly (defaults to `lol`).
- **messageInterval**: How often to post messages in seconds. Supports decimals
  like `2.2` (defaults to `2.2`).
- **emailDomain**: Domain to use for generated emails when in `account` mode.
- **saveCredentials**: Save created usernames/emails/passwords to a file.
- **outputFile**: Path of the credentials file if saving is enabled.
- **accountCount**: How many accounts to register in one run. When greater than one, the first account opens a visible browser while the others run headless in parallel.
- **concurrency**: Maximum number of browsers launched at once. Registrations beyond this limit wait for a free slot.
- **headlessFirst**: Run the first account in headless mode as well.
- **proxyUri**: Proxy to connect through. Defaults to the built-in proxy or `PROXY_URI` env var.
- **captchaKey**: CapMonster API key, overridable via environment variable.

When `sendMessages` is enabled, each registered account sets up an internal timer inside the page that posts the message using the chosen interval. Registration for additional accounts continues in the background while earlier accounts keep posting.

The bot connects through a preset proxy when launching the browsers. You can
override the default proxy or CAPTCHA key by setting the `PROXY_URI` and
`CAPMONSTER_KEY` environment variables.
The CAPTCHA service client is created once and reused for all registrations for
better performance.

Depending on the chosen mode, the bot opens the appropriate form, fills the fields, solves the reCAPTCHA and submits the registration.
If `skipCaptcha` is enabled, the CAPTCHA step is skipped.

If the page ever shows a "You have been banned from this site" notice, the bot closes that browser and automatically launches a new one with the same settings.

Running many headless browsers at once can consume CPU and memory. Adjust
`accountCount` accordingly on low-end machines.
