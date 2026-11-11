import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useControl } from 'react-map-gl/mapbox';
import MapboxDraw from '@mapbox/mapbox-gl-draw';

// Custom dark-theme-friendly MapboxDraw styles compatible with Mapbox GL JS v3
const DRAW_STYLES = [
  {
    id: 'gl-draw-polygon-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: {
      'fill-color': ['case', ['==', ['get', 'active'], 'true'], '#f59e0b', '#38bdf8'],
      'fill-opacity': 0.12,
    },
  },
  {
    id: 'gl-draw-line-inactive',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString'], ['!=', 'active', 'true']],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#f59e0b',
      'line-dasharray': [2, 2],
      'line-width': 3,
      'line-opacity': 0.75,
    },
  },
  {
    id: 'gl-draw-line-active',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#fbbf24',
      'line-dasharray': [0.2, 2],
      'line-width': 4,
    },
  },
  {
    id: 'gl-draw-polygon-stroke',
    type: 'line',
    filter: ['all', ['==', '$type', 'Polygon']],
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': ['case', ['==', ['get', 'active'], 'true'], '#fbbf24', '#38bdf8'],
      'line-width': 2,
    },
  },
  {
    id: 'gl-draw-point-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 8, 6],
      'circle-color': '#0f172a',
    },
  },
  {
    id: 'gl-draw-point-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 5, 4],
      'circle-color': ['case', ['==', ['get', 'active'], 'true'], '#fbbf24', '#38bdf8'],
    },
  },
  {
    id: 'gl-draw-vertex-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 10, 8],
      'circle-color': '#0f172a',
    },
  },
  {
    id: 'gl-draw-vertex-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 7, 5],
      'circle-color': '#fbbf24',
    },
  },
  {
    id: 'gl-draw-midpoint',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'midpoint']],
    paint: {
      'circle-radius': 6,
      'circle-color': '#38bdf8',
    },
  },
];

/**
 * React wrapper around @mapbox/mapbox-gl-draw using react-map-gl v8's useControl hook.
 * Exposes imperative draw actions via ref and keeps event listeners bound to the latest callbacks.
 */
const DrawControl = forwardRef(function DrawControl(
  { position = 'top-left', onCreate, onUpdate, onDelete, onModeChange, onDrawProgress, ...drawOptions },
  ref
) {
  const handlersRef = useRef({ onCreate, onUpdate, onDelete, onModeChange, onDrawProgress });
  const drawInstanceRef = useRef(null);
  const lastProgressSigRef = useRef('');

  useEffect(() => {
    handlersRef.current = { onCreate, onUpdate, onDelete, onModeChange, onDrawProgress };
  }, [onCreate, onUpdate, onDelete, onModeChange, onDrawProgress]);

  const emitProgressFromInstance = useCallback((instance) => {
    if (!instance || !handlersRef.current.onDrawProgress) return;
    try {
      const mode = instance.getMode();
      if (mode !== 'draw_line_string') {
        if (lastProgressSigRef.current !== '') {
          lastProgressSigRef.current = '';
          handlersRef.current.onDrawProgress([]);
        }
        return;
      }
      const line = instance.getAll()?.features?.find((f) => f.geometry?.type === 'LineString');
      const coords = line?.geometry?.coordinates || [];
      // MapboxDraw keeps 1 trailing cursor point at the end in draw_line_string mode
      const committed = coords.length >= 2 ? coords.slice(0, -1) : coords;
      const last = committed[committed.length - 1];
      const sig = `${committed.length}:${last ? `${last[0].toFixed(5)},${last[1].toFixed(5)}` : ''}`;
      if (sig !== lastProgressSigRef.current) {
        lastProgressSigRef.current = sig;
        handlersRef.current.onDrawProgress(committed);
      }
    } catch {
      // Ignore while style or draw control transitions
    }
  }, []);

  const handleCreate = useCallback((event) => {
    lastProgressSigRef.current = '';
    handlersRef.current.onCreate?.(event, drawInstanceRef.current);
  }, []);

  const handleUpdate = useCallback((event) => {
    handlersRef.current.onUpdate?.(event, drawInstanceRef.current);
  }, []);

  const handleDelete = useCallback((event) => {
    lastProgressSigRef.current = '';
    handlersRef.current.onDelete?.(event, drawInstanceRef.current);
  }, []);

  const handleModeChange = useCallback(
    (event) => {
      handlersRef.current.onModeChange?.(event, drawInstanceRef.current);
      emitProgressFromInstance(drawInstanceRef.current);
    },
    [emitProgressFromInstance],
  );

  const handleRender = useCallback(() => {
    emitProgressFromInstance(drawInstanceRef.current);
  }, [emitProgressFromInstance]);

  const draw = useControl(
    () =>
      new MapboxDraw({
        displayControlsDefault: false,
        controls: {
          line_string: true,
          trash: true,
        },
        styles: DRAW_STYLES,
        ...drawOptions,
      }),
    ({ map }) => {
      map.on('draw.create', handleCreate);
      map.on('draw.update', handleUpdate);
      map.on('draw.delete', handleDelete);
      map.on('draw.modechange', handleModeChange);
      map.on('draw.render', handleRender);
    },
    ({ map }) => {
      map.off('draw.create', handleCreate);
      map.off('draw.update', handleUpdate);
      map.off('draw.delete', handleDelete);
      map.off('draw.modechange', handleModeChange);
      map.off('draw.render', handleRender);
    },
    { position }
  );

  useEffect(() => {
    drawInstanceRef.current = draw;
  }, [draw]);

  useImperativeHandle(
    ref,
    () => {
      const safeDraw = () => drawInstanceRef.current || draw;
      return {
        startLineDrawing() {
          try {
            safeDraw()?.changeMode('draw_line_string');
          } catch {
            // Ignore during style reload or unmount
          }
        },
        finishDrawing() {
          try {
            safeDraw()?.changeMode('simple_select');
          } catch {
            // Ignore during style reload or unmount
          }
        },
        clearAll() {
          try {
            const instance = safeDraw();
            instance?.deleteAll();
            instance?.changeMode('simple_select');
          } catch {
            // Ignore during style reload or unmount
          }
        },
        setLineCoordinates(coordinates) {
          if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
          try {
            const ids = safeDraw()?.set({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'LineString',
                    coordinates,
                  },
                },
              ],
            });
            return ids?.[0] || null;
          } catch {
            return null;
          }
        },
        editCurrentLine() {
          try {
            const instance = safeDraw();
            const features = instance?.getAll()?.features || [];
            const line = features.find((f) => f.geometry?.type === 'LineString');
            if (!line?.id) return false;
            instance.changeMode('direct_select', { featureId: line.id });
            return true;
          } catch {
            return false;
          }
        },
        dropLastDrawingPoint() {
          try {
            const instance = safeDraw();
            if (!instance || instance.getMode() !== 'draw_line_string') return false;
            const line = instance.getAll()?.features?.find((f) => f.geometry?.type === 'LineString');
            const rawCoords = line?.geometry?.coordinates || [];
            const committed = rawCoords.length >= 2 ? rawCoords.slice(0, -1) : rawCoords;
            const remaining = committed.slice(0, -1);

            if (remaining.length >= 2) {
              const ids = instance.set({
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                      type: 'LineString',
                      coordinates: remaining,
                    },
                  },
                ],
              });
              const featureId = ids?.[0];
              if (featureId) {
                instance.changeMode('draw_line_string', {
                  featureId,
                  from: remaining[remaining.length - 1],
                });
                emitProgressFromInstance(instance);
                return true;
              }
            }

            instance.deleteAll();
            instance.changeMode('draw_line_string');
            lastProgressSigRef.current = '';
            handlersRef.current.onDrawProgress?.([]);
            return true;
          } catch {
            return false;
          }
        },
        deleteFeatures(ids) {
          if (!ids?.length) return;
          try {
            safeDraw()?.delete(ids);
          } catch {
            // Ignore during style reload or unmount
          }
        },
        getAll() {
          try {
            return safeDraw()?.getAll() || { type: 'FeatureCollection', features: [] };
          } catch {
            return { type: 'FeatureCollection', features: [] };
          }
        },
        getMode() {
          try {
            return safeDraw()?.getMode() || 'simple_select';
          } catch {
            return 'simple_select';
          }
        },
      };
    },
    [draw, emitProgressFromInstance]
  );

  return null;
});

export default DrawControl;

