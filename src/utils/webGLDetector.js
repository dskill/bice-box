const WebGLDetector = {
  isWebGLAvailable: function() {
    try {
      const canvas = document.createElement('canvas');
      return !!(
        window.WebGLRenderingContext && 
        (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch (e) {
      return false;
    }
  },
  
  testWebGLCapabilities: function() {
    const canvas = document.createElement('canvas');
    let gl = null;
    let capabilities = {
      supported: false,
      webGL1: false,
      webGL2: false,
      details: "Unknown error"
    };

    // Try WebGL2 first
    try {
      gl = canvas.getContext('webgl2');
      if (gl) {
        capabilities.supported = true;
        capabilities.webGL2 = true;
        capabilities.webGL1 = true; // WebGL2 also supports WebGL1 features
        capabilities.details = this.getContextDetails(gl);
        console.log("WebGL2 context obtained.");
        return capabilities;
      }
    } catch (e) {
      console.warn("WebGL2 context creation failed:", e);
    }

    // Fallback to WebGL1 if WebGL2 failed
    try {
      gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        capabilities.supported = true;
        capabilities.webGL1 = true;
        capabilities.webGL2 = false;
        capabilities.details = this.getContextDetails(gl);
        console.log("WebGL1 context obtained.");
        return capabilities;
      }
    } catch (e) {
      console.warn("WebGL1 context creation failed:", e);
    }

    // If both failed
    capabilities.details = "Neither WebGL2 nor WebGL1 context could be created.";
    console.error(capabilities.details);
    return capabilities;
  },

  getContextDetails: function(gl) {
    if (!gl) return "No GL context";
    // Test shader compilation (simple shaders, should work on both WebGL1 & 2)
    const vertShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertShader, 'void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }');
    gl.compileShader(vertShader);
    
    const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragShader, 'void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }');
    gl.compileShader(fragShader);
    
    // Test framebuffer creation
    const framebuffer = gl.createFramebuffer();
    gl.deleteShader(vertShader); // Clean up shaders
    gl.deleteShader(fragShader);
    gl.deleteFramebuffer(framebuffer); // Clean up framebuffer

    return {
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      extensions: gl.getSupportedExtensions(),
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
    };
  },
  
  isPlatformRaspberryPi: function() {
    return typeof navigator !== 'undefined' && 
           navigator.userAgent.toLowerCase().includes('linux') && 
           (navigator.userAgent.toLowerCase().includes('arm') || 
            navigator.platform.toLowerCase().includes('arm'));
  }
};

export default WebGLDetector;