"use client";

import { CloseIcon } from "@/components/CloseIcon";
import { NoAgentNotification } from "@/components/NoAgentNotification";
import TranscriptionView from "@/components/TranscriptionView";
import {
  BarVisualizer,
  DisconnectButton,
  RoomAudioRenderer,
  RoomContext,
  VideoTrack,
  VoiceAssistantControlBar,
  useVoiceAssistant,
} from "@livekit/components-react";
import { AnimatePresence, motion } from "framer-motion";
import { ConnectionState, Room, RoomEvent } from "livekit-client";
import { useCallback, useEffect, useState } from "react";

export default function Page() {
  const [room] = useState(new Room({
    // Adding specific LiveKit configuration to improve connection stability
    adaptiveStream: true,
    dynacast: true,
    // Increase connection timeout
    stopLocalTrackOnUnpublish: true,
    reconnectPolicy: {
      maxRetries: 10, // Increase retry attempts
      timeoutBackoff: 2, // Exponential backoff
    }
  }));
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    room.state
  );

  // Track room connection state
  useEffect(() => {
    const handleConnectionStateChanged = (state: ConnectionState) => {
      console.log("Connection state changed:", state);
      setConnectionState(state);
      
      if (state === "disconnected") {
        setIsConnecting(false);
      } else if (state === "connecting") {
        setIsConnecting(true);
      } else if (state === "connected") {
        setIsConnecting(false);
        setError("");
      }
    };

    room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
    
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
    };
  }, [room]);

  const onConnectButtonClicked = useCallback(async () => {
    setIsConnecting(true);
    setError("");
    
    const identity = prompt("Enter your name (identity):", "dennis") || "guest";
    const roomName = prompt("Enter room name:", "default") || "default";

    try {
      // Using the backend URL directly for the token endpoint
      const tokenRes = await fetch(`https://caligo-backend-production.up.railway.app/api/token?identity=${identity}&room=${roomName}`);
      
      if (!tokenRes.ok) {
        throw new Error(`Failed to get token: ${tokenRes.status} ${tokenRes.statusText}`);
      }
      
      const { token } = await tokenRes.json();

      const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
      if (!livekitUrl) {
        throw new Error("Missing NEXT_PUBLIC_LIVEKIT_URL. Please check your environment variables.");
      }

      console.log(`Connecting to LiveKit server at: ${livekitUrl}`);
      
      // Important: Disconnect from any previous session first
      if (room.state !== "disconnected") {
        await room.disconnect();
      }
      
      // Use a timeout to ensure connect doesn't hang indefinitely
      const connectPromise = room.connect(livekitUrl, token);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Connection timed out after 15 seconds")), 15000);
      });
      
      await Promise.race([connectPromise, timeoutPromise]);
      
      // Only enable microphone if connection was successful
      if (room.state === "connected") {
        console.log("Successfully connected to room:", roomName);
        await room.localParticipant.setMicrophoneEnabled(true);
      }
    } catch (error: unknown) {
      console.error("Failed to connect:", error);
      
      // Type-safe error handling
      let errorMessage = "Failed to connect to room";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      setError(errorMessage);
      setIsConnecting(false);
      
      // Try to clean up if connection fails
      if (room.state !== "disconnected") {
        try {
          await room.disconnect();
        } catch (disconnectError) {
          console.error("Error during disconnect:", disconnectError);
        }
      }
    }
  }, [room]);

  const disconnectFromRoom = useCallback(() => {
    if (room.state !== "disconnected") {
      room.disconnect();
    }
  }, [room]);

  useEffect(() => {
    // Setup event listeners
    const handleError = (error: Error) => {
      console.error("Room error:", error);
      setError(`LiveKit error: ${error.message}`);
    };
    
    const handleDisconnected = () => {
      console.log("Room disconnected");
      setIsConnecting(false);
    };
    
    room.on(RoomEvent.MediaDevicesError, onDeviceFailure);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.SignalConnected, () => console.log("Signal connected"));
    room.on(RoomEvent.Reconnecting, () => {
      console.log("Reconnecting to room");
      setIsConnecting(true);
    });
    room.on(RoomEvent.Reconnected, () => {
      console.log("Reconnected to room");
      setIsConnecting(false);
    });
    room.on(RoomEvent.RoomMetadataChanged, (metadata) => console.log("Room metadata:", metadata));
    room.on(RoomEvent.ConnectionQualityChanged, (quality) => console.log("Connection quality:", quality));
    room.on(RoomEvent.Error, handleError);
    
    // Clean up the room when component unmounts
    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceFailure);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.SignalConnected);
      room.off(RoomEvent.Reconnecting);
      room.off(RoomEvent.Reconnected);
      room.off(RoomEvent.RoomMetadataChanged);
      room.off(RoomEvent.ConnectionQualityChanged);
      room.off(RoomEvent.Error, handleError);
      disconnectFromRoom();
    };
  }, [room, disconnectFromRoom]);

  return (
    <main data-lk-theme="default" className="h-full grid content-center bg-[var(--lk-bg)]">
      <RoomContext.Provider value={room}>
        <div className="lk-room-container max-w-[1024px] w-[90vw] mx-auto max-h-[90vh]">
          <SimpleVoiceAssistant 
            onConnectButtonClicked={onConnectButtonClicked} 
            isConnecting={isConnecting}
            error={error}
            connectionState={connectionState}
          />
        </div>
      </RoomContext.Provider>
    </main>
  );
}

function SimpleVoiceAssistant(props: { 
  onConnectButtonClicked: () => void; 
  isConnecting: boolean;
  error: string;
  connectionState: ConnectionState;
}) {
  const { state: agentState } = useVoiceAssistant();
  const { isConnecting, error, connectionState } = props;

  return (
    <>
      <AnimatePresence mode="wait">
        {agentState === "disconnected" ? (
          <motion.div
            key="disconnected"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="grid items-center justify-center h-full"
          >
            <div className="flex flex-col items-center gap-4">
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="uppercase px-4 py-2 bg-white text-black rounded-md disabled:opacity-50"
                onClick={props.onConnectButtonClicked}
                disabled={isConnecting}
              >
                {isConnecting ? "Connecting..." : "Start a conversation"}
              </motion.button>
              
              {connectionState === "reconnecting" && (
                <div className="text-yellow-500 text-sm mt-2">
                  Reconnecting to LiveKit server...
                </div>
              )}
              
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-500 text-sm mt-2 text-center max-w-md"
                >
                  {error}
                </motion.div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="connected"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="flex flex-col items-center gap-4 h-full"
          >
            <AgentVisualizer />
            <div className="flex-1 w-full">
              <TranscriptionView />
            </div>
            <div className="w-full">
              <ControlBar onConnectButtonClicked={props.onConnectButtonClicked} />
            </div>
            <RoomAudioRenderer />
            <NoAgentNotification state={agentState} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function AgentVisualizer() {
  const { state: agentState, videoTrack, audioTrack } = useVoiceAssistant();

  if (videoTrack) {
    return (
      <div className="h-[512px] w-[512px] rounded-lg overflow-hidden">
        <VideoTrack trackRef={videoTrack} />
      </div>
    );
  }

  return (
    <div className="h-[300px] w-full">
      <BarVisualizer
        state={agentState}
        barCount={5}
        trackRef={audioTrack}
        className="agent-visualizer"
        options={{ minHeight: 24 }}
      />
    </div>
  );
}

function ControlBar(props: { onConnectButtonClicked: () => void }) {
  const { state: agentState } = useVoiceAssistant();

  return (
    <div className="relative h-[60px]">
      <AnimatePresence>
        {agentState === "disconnected" && (
          <motion.button
            initial={{ opacity: 0, top: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, top: "-10px" }}
            transition={{ duration: 1, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="uppercase absolute left-1/2 -translate-x-1/2 px-4 py-2 bg-white text-black rounded-md"
            onClick={props.onConnectButtonClicked}
          >
            Start a conversation
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {agentState !== "disconnected" && agentState !== "connecting" && (
          <motion.div
            initial={{ opacity: 0, top: "10px" }}
            animate={{ opacity: 1, top: 0 }}
            exit={{ opacity: 0, top: "-10px" }}
            transition={{ duration: 0.4, ease: [0.09, 1.04, 0.245, 1.055] }}
            className="flex h-8 absolute left-1/2 -translate-x-1/2 justify-center"
          >
            <VoiceAssistantControlBar controls={{ leave: false }} />
            <DisconnectButton>
              <CloseIcon />
            </DisconnectButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function onDeviceFailure(error: Error) {
  console.error("Media device error:", error);
  alert(
    "Error accessing your camera or microphone. Please make sure you grant the necessary permissions in your browser and reload the page."
  );
}
