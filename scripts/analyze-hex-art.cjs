// Quick analysis script to understand hex art sizes in MUD logs
const fs = require('fs');
const path = require('path');

const logDir = path.join('C:', 'Users', 'titom', 'Dropbox', 'MUSH', 'MUSHclient', 'logs');
const files = fs.readdirSync(logDir).filter(f => f.endsWith('.txt')).slice(-10);
const showSmall = process.argv[2] === 'small';

let totalBlocks = 0;
const sizeCounts = {};

for (const file of files) {
  const lines = fs.readFileSync(path.join(logDir, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('You gaze at your surroundings')) {
      let j = i + 1;
      if (j < lines.length && lines[j].trim() === '') j++;
      const artStart = j;
      while (j < lines.length) {
        const l = lines[j];
        if (l.includes('-----') || /^\s*\//.test(l) || /\/\s*$/.test(l)) {
          j++;
        } else {
          break;
        }
      }
      const size = j - artStart;
      totalBlocks++;
      sizeCounts[size] = (sizeCounts[size] || 0) + 1;

      if (showSmall && size <= 17) {
        console.log(`=== ${file} line ${i + 1} size=${size} ===`);
        for (let k = i; k < Math.min(j + 3, lines.length); k++) {
          console.log(`L${k - i}: ${lines[k]}`);
        }
        console.log('');
      }
    }
  }
}

if (!showSmall) {
  console.log(`Analyzed ${files.length} log files`);
  console.log(`Found ${totalBlocks} hex art blocks`);
  console.log('Size distribution:');
  for (const [size, count] of Object.entries(sizeCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${size} lines: ${count} occurrences`);
  }
}
