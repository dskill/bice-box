// Vapor wave color palette
export const colors = {
  cyan: '#00FFFF',
  neonPink: '#FF71CE',
  brightBlue: '#01CDFE',
  hotMagenta: '#FF00FF',
  neonGreen: '#05FFA1',
  brightPurple: '#B967FF'
};

// Create an array of just the color values for backwards compatibility
export const colorArray = Object.values(colors);

// Helper function to generate a color based on an index
export const generateColor = (index) => {
  return colorArray[index % colorArray.length];
}; 