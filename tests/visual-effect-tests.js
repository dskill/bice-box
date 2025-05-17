const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Array to store test results
const testResults = [];
const TIMEOUT_MS = 1000;  //.5 seconds per effect test
let devMode = false; // Add dev mode flag

// Get effects repo path
function getEffectsRepoPath() {
  return app.getPath("home") + '/bice-box-effects';
}

// Get effects path
function getEffectsPath() {
  return getEffectsRepoPath() + '/effects';
}

// Get platform info
function getPlatformInfo() {
  const isRaspberryPi = process.platform === 'linux' && 
                        (process.arch === 'arm' || process.arch === 'arm64');
  return {
    platform: process.platform,
    arch: process.arch,
    isRaspberryPi: isRaspberryPi,
    osVersion: require('os').version(),
    totalMemory: require('os').totalmem() / (1024 * 1024) + 'MB',
    freeMemory: require('os').freemem() / (1024 * 1024) + 'MB'
  };
}

// Load p5 sketch content
function loadP5SketchSync(sketchPath, getEffectsRepoPath) {
  try {
    const fullPath = path.join(getEffectsRepoPath(), sketchPath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8');
    }
    console.error(`P5 sketch file not found: ${fullPath}`);
    return null;
  } catch (error) {
    console.error(`Error loading P5 sketch: ${error}`);
    return null;
  }
}

// Load all effects
function loadEffects() {
  const effectsPath = getEffectsPath();
  console.log('Loading effects from:', effectsPath);
  
  try {
    const effectFiles = fs.readdirSync(effectsPath)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(effectsPath, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Skip non-curated effects in non-dev mode - DISABLED to test ALL effects
        /*
        if (!devMode && !data.curated) {
          console.log(`Skipping non-curated effect: ${data.name}`);
          return null;
        }
        */
        
        return {
          name: data.name,
          path: filePath,
          p5SketchPath: data.visual,
          p5SketchContent: loadP5SketchSync(data.visual, getEffectsRepoPath),
          visual: path.join(getEffectsRepoPath(), data.visual),
          curated: data.curated || false
        };
      })
      .filter(effect => effect !== null); // Remove skipped effects
    
    console.log(`Loaded ${effectFiles.length} effects`);
    return effectFiles;
  } catch (error) {
    console.error('Error loading effects:', error);
    return [];
  }
}

// Test a single visual effect
function testVisualEffect(effect, window) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        name: effect.name,
        success: false,
        error: 'Timeout - render did not complete'
      });
    }, TIMEOUT_MS);

    // Skip if no p5 sketch content
    if (!effect.p5SketchContent) {
      clearTimeout(timeout);
      resolve({
        name: effect.name,
        success: false,
        error: 'No p5 sketch content found'
      });
      return;
    }

    // Create renderer test page
    window.loadFile(path.join(__dirname, 'test-renderer.html'));
    
    window.webContents.removeAllListeners('did-finish-load');
    window.webContents.removeAllListeners('did-stop-loading');
    
    window.webContents.on('did-finish-load', () => {
      // Load and test the effect
      window.webContents.executeJavaScript(`
        testRenderEffect("${effect.visual}", ${JSON.stringify(effect.p5SketchContent)})
          .then(result => {
            return {
              name: "${effect.name}",
              success: result.success,
              error: result.error || null,
              frames: result.frames,
              renderTime: result.renderTime,
              memoryUsage: result.memoryUsage
            };
          });
      `)
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeout);
        resolve({
          name: effect.name,
          success: false,
          error: error.toString()
        });
      });
    });
  });
}

// Main test runner
async function runTests() {
  console.log('Starting visual effect tests...');
  
  // Create test window
  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,  // run headlessly in CI
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      offscreen: true,
      additionalArguments: [`--app-path=${app.getAppPath()}`]
    }
  });

  // Set base directory for file protocol
  const protocol = require('electron').protocol;
  protocol.registerFileProtocol('file', (request, callback) => {
    const url = request.url.substr(7);
    callback({ path: path.normalize(`${__dirname}/${url}`) });
  });

  // Position window in a visible area
  window.center();

  // Report platform info
  const platformInfo = getPlatformInfo();
  console.log('Platform information:', platformInfo);
  
  // Load all effects
  const effects = loadEffects();
  console.log(`Found ${effects.length} effects to test`);
  
  // Test each effect sequentially
  for (const effect of effects) {
    console.log(`Testing effect: ${effect.name} (${effect.curated ? 'curated' : 'non-curated'})`);
    const result = await testVisualEffect(effect, window);
    testResults.push(result);
    console.log(`${effect.name}: ${result.success ? 'SUCCESS' : 'FAILED'} ${result.error ? '- ' + result.error : ''}`);
  }
  
  // Summarize results
  const successCount = testResults.filter(r => r.success).length;
  console.log(`\nTest Summary: ${successCount}/${testResults.length} effects rendered successfully\n`);
  
  // Create results report
  const report = {
    timestamp: new Date().toISOString(),
    platformInfo,
    results: testResults,
    summary: {
      total: testResults.length,
      success: successCount,
      failed: testResults.length - successCount
    }
  };
  
  // Save report to file
  const reportPath = path.join(app.getPath('userData'), 'visual-test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Full report saved to ${reportPath}`);
  
  // Close window
  window.close();
  app.quit();
}

// Start tests when app is ready
app.whenReady().then(runTests);