
import { useEffect, useState, useRef } from 'react';
import * as faceapi from 'face-api.js';

const MODELS_URL = '/models';

export function useFaceApi() {
  const [isReady, setIsReady] = useState(false);
  const isReadyRef = useRef(false);

  useEffect(() => {
    const loadModels = async () => {
      if (isReadyRef.current) return;
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODELS_URL),
        ]);
        isReadyRef.current = true;
        setIsReady(true);
      } catch (error) {
        console.error("Error loading face-api models:", error);
      }
    };
    loadModels();
  }, []);

  return isReady;
}
