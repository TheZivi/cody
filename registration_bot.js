// Puppeteer script to automate Cody chat registration.
// Prompts for site, cf_clearance, and a `mode` option to register either
// a full user account or a guest profile. Supports optional CAPTCHA solving
// and message spamming after registration.
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import inquirer from 'inquirer';
import fs from 'fs';
import {
  CapMonsterCloudClientFactory,
  ClientOptions,
  RecaptchaV2Request
} from '@zennolab_com/capmonstercloud-client';

const bannedText = 'You have been banned from this site';

puppeteer.use(StealthPlugin());

// Proxy credentials can be provided via the PROXY_URI environment variable
// in the form user:pass@host:port
const defaultProxy =
  'pcSAhEGN2N-res-any:PC_8jVAtII8AYs7ieB3E@proxy-us.proxy-cheap.com:5959';
let proxy = process.env.PROXY_URI || defaultProxy;
let [proxyCred, proxyServer] = proxy.split('@');
let [proxyUser, proxyPass] = proxyCred.split(':');

const defaultCaptchaKey = 'b1b1c099a0d6402b4d4725de8926fc4f';

const randomString = (len) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

// Compatibility helper for waiting
const waitTime = async (page, ms) => {
  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(ms);
  } else if (typeof page.waitFor === 'function') {
    await page.waitFor(ms);
  } else {
    await new Promise((r) => setTimeout(r, ms));
  }
};

const checkBanned = (page) =>
  page.evaluate((text) => document.body && document.body.innerText.includes(text), bannedText);

let cmcClient;

// Run an array of async functions with a maximum number of concurrent workers
const runWithConcurrency = async (tasks, limit) => {
  const queue = tasks.slice();
  const workers = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    workers.push(
      (async function worker() {
        while (queue.length) {
          const job = queue.shift();
          try {
            await job();
          } catch (err) {
            console.error('[!] Worker error:', err.message);
          }
        }
      })()
    );
  }
  await Promise.all(workers);
};

const runUntilSuccess = async (options) => {
  while (true) {
    const result = await registerOnce(options);
    if (result === 'banned') {
      console.log('[#] Restarting session after ban...');
      continue;
    }
    break;
  }
};

const registerOnce = async ({
  site,
  cf_clearance,
  mode,
  skipCaptcha,
  sendMessages,
  messageText,
  messageInterval,
  emailDomain,
  outputFile,
  headless
}) => {
  const browser = await puppeteer.launch({
    headless,
    args: [
      `--proxy-server=${proxyServer}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-extensions'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.authenticate({ username: proxyUser, password: proxyPass });

  try {
    await page.setCookie({
      name: 'cf_clearance',
      value: cf_clearance,
      domain: new URL(site).hostname,
      path: '/',
      httpOnly: true,
      secure: true
    });

    await page.setUserAgent(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${
        Math.floor(Math.random() * 30) + 90}.0.0.0 Safari/537.36`
    );

    console.log(`[+] Navigating to ${site}`);
    await page.goto(site, { waitUntil: 'networkidle2', timeout: 60000 });

    if (await checkBanned(page)) {
      console.log('[!] Banned message detected on load');
      await browser.close();
      return 'banned';
    }

  const action = mode === 'guest' ? 'getGuestLogin' : 'getRegistration';
  const hasAction = await page.evaluate((fn) => typeof window[fn] === 'function', action);
  if (hasAction) {
    console.log(`[+] Triggering ${mode} modal`);
    await page.evaluate((fn) => window[fn](), action);
  } else {
    console.log(`[!] ${action} not found u2014 attempting button click`);
    const clicked = await page.evaluate((fn) => {
      const btn = document.querySelector(`button[onclick="${fn}();"]`);
      if (btn) { btn.click(); return true; }
      return false;
    }, action);
    if (!clicked) {
      console.log('[!] Could not trigger modal, aborting.');
      await browser.close();
      return;
    }
  }

  const formSelector = mode === 'guest' ? '#guest_form_box' : '#registration_form_box';
  await page.waitForSelector(formSelector, { timeout: 15000 });

  let username = randomString(6);
  const email = `${randomString(8)}@${emailDomain}`;
  const password = 'password';

  if (mode === 'guest') {
    console.log(`[+] Filling guest username: ${username}`);
    await page.type('#guest_username', username, { delay: 100 });
    try {
      await page.select('#guest_gender', '1');
      await page.select('#guest_age', '18');
    } catch (err) {
      console.log('[!] Could not select gender/age, skipping...');
    }
  } else {
    console.log(`[+] Filling account form: ${username}, ${email}, ${password}`);
    await page.type('#reg_username', username, { delay: 100 });
    await page.type('#reg_password', password, { delay: 100 });
    await page.type('#reg_email', email, { delay: 100 });
    try {
      await page.select('#login_select_gender', '1');
      await page.select('#login_select_age', '18');
    } catch (err) {
      console.log('[!] Could not select gender/age, skipping...');
    }
  }


  if (!skipCaptcha) {
    const siteKey = await page.evaluate(() => window.recaptKey || null);

    if (!siteKey) {
      console.log('[!] No reCAPTCHA sitekey found. Aborting.');
      await browser.close();
      return;
    }

    console.log(`[+] Solving CAPTCHA with sitekey: ${siteKey}`);
    const recaptchaRequest = new RecaptchaV2Request({
      websiteURL: site,
      websiteKey: siteKey
    });

    const solution = await cmcClient.Solve(recaptchaRequest);
    console.log(`[+] CAPTCHA solved: ${solution.solution.gRecaptchaResponse}`);

    await page.evaluate((token) => {
      const el = document.getElementById('g-recaptcha-response');
      if (el) {
        el.value = token;
      } else {
        console.log('[!] Could not find g-recaptcha-response field.');
      }
    }, solution.solution.gRecaptchaResponse);
  } else {
    console.log('[+] Skipping CAPTCHA solving');
  }

  if (mode === 'guest') {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' , timeout: 60000 }),
      page.evaluate(() => {
        if (typeof sendGuestLogin === 'function') {
          sendGuestLogin();
        } else {
          const btn = document.querySelector('button[onclick="sendGuestLogin();"]');
          if (btn) btn.click();
        }
      })
    ]);
    console.log('[+] Submitted guest registration');
    await waitTime(page, 1000);
    if (await checkBanned(page)) {
      console.log('[!] Banned after guest registration');
      await browser.close();
      return 'banned';
    }
    if (outputFile) {
      fs.appendFileSync(outputFile, `${username}\n`);
    }
  } else {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' , timeout: 60000 }),
      page.click('#register_button')
    ]);
    console.log('[+] Submitted account registration');
    await waitTime(page, 1000);
    if (await checkBanned(page)) {
      console.log('[!] Banned after account registration');
      await browser.close();
      return 'banned';
    }
    if (outputFile) {
      fs.appendFileSync(outputFile, `${username},${email},${password}\n`);
    }
  }

  if (sendMessages) {
    console.log(`[#] Waiting for chat to be ready to send messages`);
    try {
      await page.waitForFunction(
        () => typeof processChatPost === 'function',
        { timeout: 30000 }
      );
    } catch (e) {
      console.log('[!] processChatPost not available, attempting anyway');
    }

    console.log(`[+] Sending messages every ${messageInterval / 1000}s: "${messageText}"`);
    await page.evaluate((msg, interval) => {
      if (typeof processChatPost === 'function') {
        window._spamTimer = setInterval(() => processChatPost(msg), interval);
      }
    }, messageText, messageInterval);
    page
      .waitForFunction(
        (text) => document.body && document.body.innerText.includes(text),
        { polling: 2000 },
        bannedText
      )
      .then(async () => {
        console.log('[!] Banned while sending messages');
        try { await browser.close(); } catch (e) {}
      });
    return;
  } else {
    await waitTime(page, 5000);
  }
  } catch (err) {
    console.error('[!] Registration error:', err.message);
  } finally {
    if (!sendMessages) {
      try { await browser.close(); } catch (e) {}
    }
  }
};

const runBot = async () => {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'site',
      message: 'Enter full site URL (e.g. https://osints.store/):'
    },
    {
      type: 'input',
      name: 'cf_clearance',
      message: 'Enter your cf_clearance cookie value:'
    },
    {
      type: 'list',
      name: 'mode',
      message: 'Choose registration mode:',
      choices: ['account', 'guest'],
      default: 'account'
    },
    {
      type: 'confirm',
      name: 'skipCaptcha',
      message: 'Skip solving reCAPTCHA?',
      default: false
    },
    {
      type: 'confirm',
      name: 'sendMessages',
      message: 'Send chat messages after registration?',
      default: false
    },
    {
      type: 'input',
      name: 'messageText',
      message: 'Message text to send:',
      default: 'lol',
      when: (ans) => ans.sendMessages
    },
    {
      type: 'input',
      name: 'messageInterval',
      message: 'Message interval in seconds:',
      default: '2.2',
      when: (ans) => ans.sendMessages,
      filter: (v) => {
        const num = parseFloat(v);
        return isNaN(num) ? 2200 : num * 1000;
      }
    },
    {
      type: 'input',
      name: 'emailDomain',
      message: 'Email domain for new accounts:',
      default: 'example.com',
      when: (ans) => ans.mode === 'account'
    },
    {
      type: 'confirm',
      name: 'saveCredentials',
      message: 'Save created credentials to file?',
      default: false
    },
    {
      type: 'input',
      name: 'outputFile',
      message: 'Output file path:',
      default: 'accounts.txt',
      when: (ans) => ans.saveCredentials
    },
    {
      type: 'number',
      name: 'accountCount',
      message: 'Number of accounts to register:',
      default: 1,
      filter: (v) => parseInt(v, 10) || 1
    },
    {
      type: 'number',
      name: 'concurrency',
      message: 'Max concurrent browsers:',
      default: 2,
      filter: (v) => parseInt(v, 10) || 1
    },
    {
      type: 'confirm',
      name: 'headlessFirst',
      message: 'Run first account headless as well?',
      default: false
    },
    {
      type: 'input',
      name: 'proxyUri',
      message: 'Proxy URI (user:pass@host:port):',
      default: process.env.PROXY_URI || defaultProxy
    },
    {
      type: 'input',
      name: 'captchaKey',
      message: 'CapMonster API key:',
      default: process.env.CAPMONSTER_KEY || defaultCaptchaKey
    }
  ]);

  const config = {
    site: answers.site.trim(),
    cf_clearance: answers.cf_clearance.trim(),
    mode: answers.mode,
    skipCaptcha: answers.skipCaptcha,
    sendMessages: answers.sendMessages,
    messageText: answers.messageText || 'lol',
    messageInterval: answers.messageInterval || 2200,
    emailDomain: answers.emailDomain || 'example.com',
    outputFile: answers.outputFile && answers.outputFile.trim()
  };

  proxy = answers.proxyUri || proxy;
  [proxyCred, proxyServer] = proxy.split('@');
  [proxyUser, proxyPass] = proxyCred.split(':');

  cmcClient = CapMonsterCloudClientFactory.Create(
    new ClientOptions({ clientKey: answers.captchaKey || defaultCaptchaKey })
  );

  const count = answers.accountCount || 1;
  const limit = answers.concurrency || 1;

  const jobFns = [];
  for (let i = 0; i < count; i++) {
    const headless = i > 0 || answers.headlessFirst;
    jobFns.push(() => {
      console.log(`[+] Starting registration ${i + 1}/${count} (headless: ${headless})`);
      return runUntilSuccess({ ...config, headless });
    });
  }

  await runWithConcurrency(jobFns, limit);
};

runBot();
