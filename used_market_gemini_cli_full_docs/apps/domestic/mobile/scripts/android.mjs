import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConsoleLog, TwaGenerator, TwaManifest, fetchUtils } from '@bubblewrap/core';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = path.join(root, 'android');
const publicRoot = path.resolve(root, '../web-backend/public');
const configFile = path.join(root, 'twa-manifest.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const GRADLE_SHA256 = 'f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6';
const assetNames = ['manifest.webmanifest', 'icons/app-192.png', 'icons/app-512.png',
  'icons/maskable-512.png', 'icons/play-store-512.png'];

async function config() {
  const data = JSON.parse(await readFile(configFile, 'utf8'));
  if (data.packageId !== 'com.usedpick.app' ||
      data.host !== 'used-pick.com' || data.startUrl !== '/?source=app' ||
      data.webManifestUrl !== 'https://used-pick.com/manifest.webmanifest' ||
      data.fullScopeUrl !== 'https://used-pick.com/' ||
      data.iconUrl !== 'https://used-pick.com/icons/app-512.png' ||
      data.maskableIconUrl !== 'https://used-pick.com/icons/maskable-512.png' ||
      data.fallbackType !== 'customtabs' || data.additionalTrustedOrigins.length ||
      data.signingKey.path || data.signingKey.alias || data.fingerprints.length ||
      Object.keys(data.features).length || data.enableNotifications ||
      !Number.isSafeInteger(data.appVersionCode) || data.appVersionCode < 1 ||
      !/^\d+\.\d+\.\d+$/.test(data.appVersion)) {
    throw new Error('Invalid target/version or unexpected signing/feature config. See docs/android-release.md.');
  }
  return data;
}

async function sourceAssets() {
  const assets = new Map();
  for (const name of assetNames) {
    const bytes = await readFile(path.join(publicRoot, name)).catch(() => {
      throw new Error(`Missing public/${name}; the primary must prepare the PWA assets first.`);
    });
    assets.set(`https://used-pick.com/${name}`, bytes);
  }
  const manifest = JSON.parse(assets.get('https://used-pick.com/manifest.webmanifest').toString());
  if (manifest.start_url !== '/?source=app' || manifest.scope !== '/') {
    throw new Error('PWA manifest must retain start_url /?source=app and scope /.');
  }
  return assets;
}

async function assertOwnedProject() {
  await mkdir(project, { recursive: true });
  if (await realpath(project) !== path.join(await realpath(root), 'android')) {
    throw new Error('android/ must be a real directory inside mobile/, not a junction/symlink.');
  }
}

async function neutralLaunch() {
  // Bubblewrap 1.27.0 always derives a custom TWA splash from iconUrl; it has
  // no manifest switch to disable it. Without this metadata Browser Helper
  // skips its splash strategy, including the extra browser splash and fade.
  const manifest = path.join(project, 'app/src/main/AndroidManifest.xml');
  const xml = (await readFile(manifest, 'utf8'))
    .replace(/\s*<meta-data\s+android:name="android\.support\.customtabs\.trusted\.(?:SPLASH_IMAGE_DRAWABLE|SPLASH_SCREEN_BACKGROUND_COLOR|SPLASH_SCREEN_FADE_OUT_DURATION)"[^>]*\/>/g, '')
    .replace('<activity android:name="LauncherActivity"',
      '<activity android:name="LauncherActivity"\n            android:theme="@style/NeutralLaunchTheme"');
  await writeFile(manifest, xml);
  // Keep the existing translucent launcher lifecycle and app icon. Android 12+
  // owns the system launch surface, but its splash icon can be transparent.
  // Isolate platform splash attributes to API 31+; minSdk 24 keeps the base theme.
  const res = path.join(project, 'app/src/main/res');
  await writeFile(path.join(project, 'app/src/main/res/values/launch_theme.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="NeutralLaunchThemeBase" parent="android:style/Theme.Translucent.NoTitleBar">
        <item name="android:windowBackground">@android:color/white</item>
        <item name="android:colorBackground">@android:color/white</item>
    </style>
    <style name="NeutralLaunchTheme" parent="NeutralLaunchThemeBase" />
</resources>
`);
  await mkdir(path.join(res, 'values-v31'), { recursive: true });
  await writeFile(path.join(res, 'values-v31/launch_theme.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="NeutralLaunchTheme" parent="NeutralLaunchThemeBase">
        <item name="android:windowSplashScreenBackground">@android:color/white</item>
        <item name="android:windowSplashScreenAnimatedIcon">@drawable/transparent_splash_icon</item>
        <item name="android:windowSplashScreenIconBackgroundColor">@android:color/transparent</item>
        <item name="android:windowSplashScreenBrandingImage">@drawable/transparent_splash_icon</item>
    </style>
</resources>
`);
  // Use an actual drawable with nonzero bounds. @null would let Android fall
  // back to the branded application icon instead of replacing the splash icon.
  await mkdir(path.join(res, 'drawable'), { recursive: true });
  await writeFile(path.join(res, 'drawable/transparent_splash_icon.xml'), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#00000000" android:pathData="M0,0h108v108h-108z" />
</vector>
`);
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    await rm(path.join(project, `app/src/main/res/drawable-${density}/splash.png`), { force: true });
  }
}

async function installNativeController() {
  const native = path.join(root, 'native');
  const java = path.join(project, 'app/src/main/java/com/usedpick/app');
  await mkdir(java, { recursive: true });
  for (const name of ['LauncherActivity.java', 'TwaController.java', 'AdManager.java', 'AdHostActivity.java']) {
    await copyFile(path.join(native, name), path.join(java, name));
  }
  await copyFile(path.join(native, 'ad_host_theme.xml'),
    path.join(project, 'app/src/main/res/values/ad_host_theme.xml'));
  await copyFile(path.join(native, 'admob.gradle'), path.join(project, 'app/admob.gradle'));
  const gradle = path.join(project, 'app/build.gradle');
  await writeFile(gradle, `${await readFile(gradle, 'utf8')}\napply from: 'admob.gradle'\n`);
  const manifest = path.join(project, 'app/src/main/AndroidManifest.xml');
  const additions = await readFile(path.join(native, 'application.xml'), 'utf8');
  const xml = (await readFile(manifest, 'utf8'))
    .replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />\n\n    <application')
    .replace('<activity android:name="LauncherActivity"',
      '<activity android:name="LauncherActivity"\n            android:configChanges="orientation|screenSize|keyboardHidden"')
    .replace('</application>', `${additions.replace(/<\/?application>/g, '').trim()}\n    </application>`);
  await writeFile(manifest, xml);
}

async function generate(mode) {
  const data = await config();
  const assets = await sourceAssets();
  await assertOwnedProject();
  const generatedConfig = path.join(project, 'twa-manifest.json');
  if (mode === 'init' && existsSync(generatedConfig)) {
    throw new Error('Project already initialized. Use npm run android:update to regenerate it.');
  }
  if (mode === 'update' && !existsSync(generatedConfig)) {
    throw new Error('Initialize first with npm run android:init.');
  }
  // Bubblewrap consumes URL assets. Supply only our checked-out public files, with
  // their production URLs retained in generated Android metadata. No profile,
  // signing key, SDK installer, network request or production write is involved.
  const originalFetch = fetchUtils.fetch;
  fetchUtils.fetch = async input => {
    const url = String(input);
    const bytes = assets.get(url);
    if (!bytes) throw new Error(`Generator requested an unexpected asset: ${url}`);
    return new Response(bytes, { headers: { 'content-type':
      url.endsWith('.png') ? 'image/png' : 'application/manifest+json' } });
  };
  try {
    await new TwaGenerator().createTwaProject(project, new TwaManifest(data), new ConsoleLog('USED PICK'));
  } finally {
    fetchUtils.fetch = originalFetch;
  }
  await neutralLaunch();
  await installNativeController();
  await writeFile(generatedConfig, `${JSON.stringify(data, null, 2)}\n`);
  // Bubblewrap CLI uses SHA-1 here solely as a change detector, not for signing.
  const checksum = createHash('sha1').update(await readFile(generatedConfig)).digest('hex');
  await writeFile(path.join(project, 'manifest-checksum.txt'), checksum);
  const wrapper = path.join(project, 'gradle/wrapper/gradle-wrapper.properties');
  await writeFile(wrapper, `${await readFile(wrapper, 'utf8')}\ndistributionSha256Sum=${GRADLE_SHA256}\n`);
  const topGradle = path.join(project, 'build.gradle');
  await writeFile(topGradle, (await readFile(topGradle, 'utf8')).replaceAll('jcenter()', 'mavenCentral()'));
  // No SDK downloads/license prompts and no global Gradle init/profile configuration.
  const props = path.join(project, 'gradle.properties');
  await writeFile(props, `${await readFile(props, 'utf8')}\nandroid.builder.sdkDownload=false\n`);
  const hashes = Object.fromEntries([...assets].map(([url, bytes]) => [url, sha256(bytes)]));
  await writeFile(path.join(project, 'source-assets.sha256.json'), `${JSON.stringify(hashes, null, 2)}\n`);
  await verifyProject();
  console.log(`Generated ${project} (unsigned; version ${data.appVersion}/${data.appVersionCode}).`);
}

async function verifyProject() {
  const data = await config();
  await assertOwnedProject();
  const generated = JSON.parse(await readFile(path.join(project, 'twa-manifest.json'), 'utf8'));
  if (JSON.stringify(data) !== JSON.stringify(generated)) {
    throw new Error('Config changed after generation; run npm run android:update.');
  }
  const gradle = await readFile(path.join(project, 'app/build.gradle'), 'utf8');
  if (!gradle.includes('compileSdkVersion 36') || !gradle.includes('targetSdkVersion 36') ||
      !gradle.includes(`applicationId: '${data.packageId}'`) ||
      !gradle.includes("hostName: 'used-pick.com'") ||
      !gradle.includes("launchUrl: '/?source=app'")) {
    throw new Error('Generated Android target SDK, identity or exact launch URL is incorrect.');
  }
  const current = await sourceAssets();
  const hashes = JSON.parse(await readFile(path.join(project, 'source-assets.sha256.json'), 'utf8'));
  if ([...current].some(([url, bytes]) => hashes[url] !== sha256(bytes))) {
    throw new Error('Public PWA assets changed; run npm run android:update before building.');
  }
  console.log(`Verified ${data.packageId}: https://${data.host}${data.startUrl}; target API 36.`);
  return data;
}

async function build() {
  const data = await verifyProject();
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const jdk = process.env.JAVA_HOME;
  if (!sdk || !jdk || !existsSync(path.join(sdk, 'platforms/android-36/android.jar')) ||
      !existsSync(path.join(sdk, 'build-tools/35.0.0/source.properties')) ||
      !existsSync(path.join(jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))) {
    throw new Error('Set JAVA_HOME (JDK 21) and ANDROID_HOME; install platform 36 and Build Tools 35.0.0 yourself. No SDK installation or license acceptance is automated.');
  }
  const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk,
    GRADLE_USER_HOME: path.join(root, '.cache/gradle') };
  const args = ['--no-daemon', '--console=plain', '--max-workers=2',
    '-Pandroid.builder.sdkDownload=false', 'assembleRelease', 'bundleRelease'];
  const win = process.platform === 'win32';
  const child = spawn(win ? (process.env.ComSpec || 'cmd.exe') : './gradlew',
    win ? ['/d', '/s', '/c', `gradlew.bat ${args.join(' ')}`] : args,
    { cwd: project, env, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Gradle failed (${code}).`)));
  });
  const artifacts = {};
  for (const name of ['app/build/outputs/apk/release/app-release-unsigned.apk',
    'app/build/outputs/bundle/release/app-release.aab']) {
    const bytes = await readFile(path.join(project, name));
    artifacts[name] = { bytes: bytes.length, sha256: sha256(bytes), signing: 'unsigned' };
  }
  const receipt = { builtAt: new Date().toISOString(), packageId: data.packageId,
    launchUrl: `https://${data.host}${data.startUrl}`, targetSdk: 36,
    appVersion: data.appVersion, appVersionCode: data.appVersionCode,
    packageLockSha256: sha256(await readFile(path.join(root, 'package-lock.json'))), artifacts };
  await writeFile(path.join(project, 'build-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  console.log('Unsigned build only. No device/TWA verification or Play submission is implied.');
}

const command = process.argv[2];
try {
  if (command === 'init' || command === 'update') await generate(command);
  else if (command === 'check') await verifyProject();
  else if (command === 'build') await build();
  else throw new Error('Usage: node scripts/android.mjs init|update|check|build');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
