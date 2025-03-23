const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Start the visual test process
console.log('Starting visual effect tests...');

const electronPath = require('electron');
const testScript = path.join(__dirname, '../tests/visual-effect-tests.js');

const testProcess = spawn(electronPath, [testScript], {
  stdio: 'inherit'
});

testProcess.on('close', (code) => {
  console.log(`Test process exited with code ${code}`);
  // Find the latest test report
  const appData = process.env.APPDATA || 
    (process.platform === 'darwin' ? 
      path.join(process.env.HOME, 'Library/Application Support') : 
      path.join(process.env.HOME, '.config'));
  
  const reportDir = path.join(appData, 'bice-box');
  
  if (fs.existsSync(reportDir)) {
    const reports = fs.readdirSync(reportDir)
      .filter(file => file.startsWith('visual-test-report'))
      .sort();
    
    if (reports.length > 0) {
      const latestReport = path.join(reportDir, reports[reports.length - 1]);
      const reportData = JSON.parse(fs.readFileSync(latestReport, 'utf8'));
      
      console.log('\nTest Summary:');
      console.log(`Platform: ${reportData.platformInfo.platform} (${reportData.platformInfo.arch})`);
      console.log(`Raspberry Pi: ${reportData.platformInfo.isRaspberryPi ? 'Yes' : 'No'}`);
      console.log(`Memory: ${reportData.platformInfo.freeMemory} free / ${reportData.platformInfo.totalMemory} total`);
      console.log(`Results: ${reportData.summary.success}/${reportData.summary.total} effects rendered successfully`);
      
      // List failed effects
      if (reportData.summary.failed > 0) {
        console.log('\nFailed effects:');
        reportData.results
          .filter(r => !r.success)
          .forEach(result => {
            console.log(`- ${result.name}: ${result.error}`);
          });
      }
    }
  }
});