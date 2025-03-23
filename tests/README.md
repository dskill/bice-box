# Visual Effects Test System

This system allows testing the rendering capabilities of different platforms (Mac and Raspberry Pi) and reporting any issues with specific effects.

## Running Tests

```bash
# Run on Mac for development testing
npm run test:visuals

# Run on Raspberry Pi 
cd /path/to/bice-box && npm run test:visuals
```

## Test Reports

Test reports are saved in the app's user data directory:
- Mac: ~/Library/Application Support/bice-box/visual-test-report.json
- Raspberry Pi: ~/.config/bice-box/visual-test-report.json

## Adding Tests for New Effects

When adding a new effect, the test system will automatically include it if:
1. It has a valid JSON configuration in the effects directory
2. It has valid paths to visual and audio files

## Troubleshooting Failed Tests

If an effect fails on Raspberry Pi but works on Mac:

1. **Optimize shader complexity**:
   - Simplify math operations
   - Reduce texture lookups
   - Avoid expensive operations (pow, exp, log)
   - Use simpler lighting calculations

2. **Optimize resource usage**:
   - Use smaller texture sizes (512x512 or less)
   - Limit or eliminate multiple render targets
   - Reduce the number of post-processing passes
   - Use lower precision when possible (mediump instead of highp)

3. **Check WebGL compatibility**:
   - Verify shader syntax works with older GLSL versions
   - Avoid advanced extensions that might not be supported
   - Test with explicit WebGL 1.0 context

4. **Performance optimizations**:
   - Reduce the number of draw calls
   - Batch similar operations
   - Use fewer particles or complex geometries
   - Consider frame rate throttling on complex effects

Remember: The goal is to have one implementation that works well on both Raspberry Pi and Mac, not separate versions for each platform.