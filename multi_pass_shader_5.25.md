# Multi-Pass Shader System Design v5.25 - IMPLEMENTED ✅

## Overview
A simplified approach to multi-pass shaders that follows ShaderToy.com conventions using file naming patterns instead of complex JSON configurations. **This system is now fully implemented and working.**

## File Naming Convention

### Single-Pass Shaders
- `shader_name.glsl` - A standalone fragment shader
- Example: `oscilloscope.glsl`, `waveform.glsl`

### Multi-Pass Shaders
- `shader_name_bufferA.glsl` - Buffer A pass
- `shader_name_bufferB.glsl` - Buffer B pass (optional)
- `shader_name_bufferC.glsl` - Buffer C pass (optional) 
- `shader_name_bufferD.glsl` - Buffer D pass (optional)
- `shader_name_image.glsl` - Final image pass
- `shader_name_common.glsl` - Common functions (optional)

Example multi-pass shader files:
```
shaders/
  oscilloscope_bufferA.glsl
  oscilloscope_image.glsl
  oscilloscope_common.glsl  (optional)
```

## Effect JSON Configuration

Effects reference shaders by base name:

### Single-Pass
```json
{
  "name": "simple_effect",
  "shader": "shaders/oscilloscope.glsl"
}
```

### Multi-Pass
```json
{
  "name": "complex_effect", 
  "shader": "shaders/oscilloscope"  // No extension = multi-pass base name
}
```

## System Behavior

### Loading Logic
1. If `shader` field ends with `.glsl` → single-pass shader
2. If `shader` field has no extension → multi-pass shader base name
3. System scans for `{base_name}_*.glsl` files to determine passes

### Auto-Discovery
When loading a multi-pass shader with base name `oscilloscope`:
1. Look for `oscilloscope_common.glsl` → load as common functions
2. Look for `oscilloscope_bufferA.glsl` → load as Buffer A
3. Look for `oscilloscope_bufferB.glsl` → load as Buffer B (if exists)
4. Look for `oscilloscope_bufferC.glsl` → load as Buffer C (if exists)
5. Look for `oscilloscope_bufferD.glsl` → load as Buffer D (if exists)
6. Look for `oscilloscope_image.glsl` → load as final Image pass

### Channel Mapping (ShaderToy Compatible)
**CRITICAL**: Channel mapping uses single letters as expected by ShaderToyLite.js:

- `iChannel0` in BufferA = BufferA's previous frame ("self") - **NOT IMPLEMENTED YET**
- `iChannel0` in BufferB = BufferB's previous frame ("self") - **NOT IMPLEMENTED YET**
- `iChannel0` in Image = BufferA output → **"A"** (not "BufferA")
- `iChannel1` in Image = BufferB output → **"B"** (not "BufferB")
- `iChannel2` in Image = BufferC output → **"C"** (not "BufferC")
- `iChannel3` in Image = BufferD output → **"D"** (not "BufferD")

### Audio Texture
- `iAudioTexture` is globally available in all passes (1024x2 RGBA8 texture)
- Row 0 (y=0.25): FFT data (pre-computed magnitudes from SuperCollider)
- Row 1 (y=0.75): Waveform data (time domain, -1 to 1 normalized)
- Access via: `texture(iAudioTexture, vec2(x_coord, 0.25))` for FFT
- Access via: `texture(iAudioTexture, vec2(x_coord, 0.75))` for waveform

## Hot Reloading
- Editing any `*_bufferA.glsl` file triggers reload of the entire multi-pass shader
- Editing any `*_image.glsl` file triggers reload of the entire multi-pass shader  
- Editing any `*_common.glsl` file triggers reload of the entire multi-pass shader
- System identifies which effect uses the changed file by base name matching
- **Works correctly** - tested and verified

## Implementation Details

### superColliderManager.js
```javascript
// Detect shader type
if (shaderPath.endsWith('.glsl')) {
  // Single-pass: load GLSL content directly
  effect.shaderContent = fs.readFileSync(fullPath, 'utf-8');
} else {
  // Multi-pass: scan for related files
  const baseName = path.basename(shaderPath);
  const shaderDir = path.dirname(fullPath);
  effect.shaderContent = loadMultiPassShader(baseName, shaderDir);
}

function loadMultiPassShader(baseName, shaderDir) {
  const result = {};
  const passTypes = ['common', 'bufferA', 'bufferB', 'bufferC', 'bufferD', 'image'];
  
  passTypes.forEach(passType => {
    const filename = `${baseName}_${passType}.glsl`;
    const fullPath = path.join(shaderDir, filename);
    if (fs.existsSync(fullPath)) {
      result[passType] = fs.readFileSync(fullPath, 'utf-8');
    }
  });
  
  return result;
}
```

### VisualizationCanvas.js
```javascript
if (typeof currentShaderContent === 'string') {
  // Single-pass
  toy.setImage({ source: currentShaderContent });
} else {
  // Multi-pass object
  if (currentShaderContent.common) {
    toy.setCommon(currentShaderContent.common);
  }
  
  // Set buffer passes (self-referencing not implemented yet)
  if (currentShaderContent.bufferA) {
    toy.setBufferA({ source: currentShaderContent.bufferA });
  }
  if (currentShaderContent.bufferB) {
    toy.setBufferB({ source: currentShaderContent.bufferB });
  }
  if (currentShaderContent.bufferC) {
    toy.setBufferC({ source: currentShaderContent.bufferC });
  }
  if (currentShaderContent.bufferD) {
    toy.setBufferD({ source: currentShaderContent.bufferD });
  }
  
  // Set image pass with automatic channel mapping
  if (currentShaderContent.image) {
    const imageConfig = { source: currentShaderContent.image };
    
    // CRITICAL: Use single letters as expected by ShaderToyLite.js
    if (currentShaderContent.bufferA) imageConfig.iChannel0 = "A";
    if (currentShaderContent.bufferB) imageConfig.iChannel1 = "B";
    if (currentShaderContent.bufferC) imageConfig.iChannel2 = "C";
    if (currentShaderContent.bufferD) imageConfig.iChannel3 = "D";
    
    toy.setImage(imageConfig);
  }
}
```

### ShaderToyLite.js Integration
- **iAudioTexture**: Created internally as 1024x2 RGBA8 texture
- **Channel mapping**: Accepts "A", "B", "C", "D" for buffer references
- **Render order**: BufferA → BufferB → BufferC → BufferD → Image
- **Ping-pong buffers**: Each buffer has front/back textures for feedback effects

## Debugging Lessons Learned

### Issue 1: Channel Mapping Case Sensitivity
**Problem**: Image pass was setting `iChannel0 = "BufferA"` but ShaderToyLite expected `"A"`
**Solution**: Changed VisualizationCanvas.js to use single letters
**Symptom**: BufferA rendered correctly but Image pass showed fallback pattern

### Issue 2: Compilation vs Runtime Issues
**Problem**: Shaders compiled successfully but BufferA output was black
**Solution**: Added debug logging to identify channel binding issues
**Key insight**: Compilation success ≠ correct channel mapping

### Issue 3: Audio Texture Format
**Problem**: Initial confusion about texture format and data layout
**Solution**: Standardized on 1024x2 RGBA8 with specific row assignments
**Format**: Row 0 = FFT, Row 1 = Waveform, both normalized to 0-255

## Testing Status

### ✅ Working Features
- Multi-pass shader loading and compilation
- BufferA → Image pass data flow
- Audio texture integration (`iAudioTexture`)
- Hot reloading of multi-pass shaders
- Automatic channel mapping
- ShaderToy-compatible uniforms (iTime, iResolution, etc.)

### 🚧 Not Yet Implemented
- Buffer self-referencing (BufferA reading its own previous frame)
- BufferB, BufferC, BufferD testing (should work but not tested)
- Complex multi-buffer interactions

### 📝 Test Files
- `bice-box-effects/effects/multipass_test.json` - Points to `"shader": "shaders/oscilloscope"`
- `bice-box-effects/shaders/oscilloscope_bufferA.glsl` - Simple animated test pattern
- `bice-box-effects/shaders/oscilloscope_image.glsl` - Displays BufferA with fallback

## Benefits
1. **Intuitive** - Matches ShaderToy.com conventions exactly
2. **Simple** - No JSON configs to maintain for shader structure
3. **Discoverable** - Easy to see what passes exist by looking at files
4. **Flexible** - Can have any combination of buffers
5. **Compatible** - Direct port from ShaderToy shaders works with minimal changes
6. **Debuggable** - Clear separation of concerns between passes

## Migration Path
- Existing single `.glsl` shaders continue to work unchanged
- New multi-pass shaders use the naming convention
- No breaking changes to existing effects
- Can gradually convert single-pass shaders to multi-pass for more complex effects

## Future Enhancements
1. **Self-referencing buffers** for feedback effects
2. **Buffer-to-buffer dependencies** beyond just Image pass
3. **Texture inputs** from external sources
4. **Performance optimizations** for complex multi-pass chains
5. **Visual debugging tools** for buffer inspection 