module.exports = class HTMLCanvasElement {
  getContext(type = '2d') {
    if (type !== '2d') {
      return null;
    }
    
    return {
      // Basic canvas operations
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: () => {},
      createImageData: () => ({ data: new Uint8ClampedArray(4) }),
      setTransform: () => {},
      resetTransform: () => {},
      
      // Text operations
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      strokeText: () => {},
      
      // Drawing operations
      drawImage: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      arc: () => {},
      arcTo: () => {},
      rect: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      
      // Path operations
      isPointInPath: () => false,
      isPointInStroke: () => false,
      
      // Transform operations
      rotate: () => {},
      scale: () => {},
      translate: () => {},
      transform: () => {},
      setLineDash: () => {},
      getLineDash: () => [],
      save: () => {},
      restore: () => {},
      reset: () => {},
      
      // Gradient operations
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createConicGradient: () => ({ addColorStop: () => {} }),
      
      // Transform matrix
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      
      // Pattern operations
      createPattern: () => null,
    };
  }
  
  get width() { return 300; }
  set width(_) {}
  get height() { return 150; }
  set height(_) {}
  
  // Add other HTMLCanvasElement properties
  get style() { return {}; }
  get className() { return ''; }
  set className(_) {}
  get id() { return ''; }
  set id(_) {}
  get tagName() { return 'CANVAS'; }
  get nodeType() { return 1; }
  get parentNode() { return null; }
  get childNodes() { return []; }
  get firstChild() { return null; }
  get lastChild() { return null; }
  get nextSibling() { return null; }
  get previousSibling() { return null; }
  get textContent() { return ''; }
  set textContent(_) {}
  get innerHTML() { return ''; }
  set innerHTML(_) {}
  get attributes() { return {}; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150 }; }
  getClientRects() { return []; }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
};

module.exports.HTMLCanvasElement = HTMLCanvasElement;
module.exports.default = HTMLCanvasElement;