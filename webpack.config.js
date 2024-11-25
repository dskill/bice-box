module.exports = {
  // ... other config ...
  devServer: {
    setupMiddlewares: (middlewares, devServer) => {
      // Add any custom middleware here if needed
      return middlewares;
    }
  }
} 