import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const apiPackagePath = resolve(root, 'apps/api/package.json');
const rootPackagePath = resolve(root, 'package.json');
const marketsPrdPath = resolve(root, 'docs/initial/high-level-PRD.md');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function check(name, condition) {
  if (!condition) {
    throw new Error(`Markets readiness check failed: ${name}`);
  }
  // eslint-disable-next-line no-console
  console.log(`PASS  ${name}`);
}

const apiPackage = readJson(apiPackagePath);
const rootPackage = readJson(rootPackagePath);
const marketsPrd = existsSync(marketsPrdPath)
  ? readFileSync(marketsPrdPath, 'utf8')
  : '';

check('api markets smoke suite script exists', Boolean(apiPackage.scripts['test:markets:smoke']));
check('api markets http suite script exists', Boolean(apiPackage.scripts['test:markets:http']));
check('api compliance suite script exists', Boolean(apiPackage.scripts['test:compliance']));
check('workspace markets gate exists', Boolean(rootPackage.scripts['test:markets']));
check('workspace compliance gate exists', Boolean(rootPackage.scripts['test:compliance']));
check('markets PRD is present', marketsPrd.length > 0);
check('markets PRD has gates section', marketsPrd.toLowerCase().includes('gate'));

// eslint-disable-next-line no-console
console.log('\nMarkets readiness verification passed.');
