const nextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        destination: "/pocket.html",
        permanent: false
      }
    ];
  }
};

export default nextConfig;
