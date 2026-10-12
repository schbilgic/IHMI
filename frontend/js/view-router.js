class ViewRouter {
  constructor(containerId, onRouteLoaded) {
    this.container = document.getElementById(containerId);
    this.onRouteLoaded = onRouteLoaded;
    this.currentView = null;
  }

  async navigate(viewName) {
    try {
      const response = await fetch(`views/${viewName}.html`);
      if (!response.ok) throw new Error(`Görünüm bulunamadı: ${viewName}`);
      
      const html = await response.text();
      this.container.innerHTML = html;
      this.currentView = viewName;

      setTimeout(() => {
        if (this.onRouteLoaded) {
          this.onRouteLoaded(viewName);
        }
      }, 50);
    } catch (err) {
      console.error('Sayfa yükleme hatası:', err.message);
    }
  }
}