const WebGLDetector = {
  isWebGLAvailable: function() {
    try {
      const canvas = document.createElement('canvas');
      return !!(
        window.WebGLRenderingContext && 
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch (e) {
      return false;
    }
  },
  
  testWebGLCapabilities: function() {
    if (!this.isWebGLAvailable()) {
      return {
        supported: false,
        details: "WebGL not available"
      };
    }
    
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      // Test shader compilation
      const vertShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vertShader, 'void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }');
      gl.compileShader(vertShader);
      
      const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fragShader, 'void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }');
      gl.compileShader(fragShader);
      
      // Test framebuffer creation
      const framebuffer = gl.createFramebuffer();
      
      // Get max texture size
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      
      // Get extensions
      const availableExtensions = gl.getSupportedExtensions();
      
      return {
        supported: true,
        details: {
          maxTextureSize,
          extensions: availableExtensions,
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
        }
      };
    } catch (e) {
      return {
        supported: false,
        details: e.toString()
      };
    }
  },
  
  isPlatformRaspberryPi: function() {
    return typeof navigator !== 'undefined' && 
           navigator.userAgent.toLowerCase().includes('linux') && 
           (navigator.userAgent.toLowerCase().includes('arm') || 
            navigator.platform.toLowerCase().includes('arm'));
  }
};

export default WebGLDetector;