import React from 'react';
import { Phone, PhoneOff, Video, Mic } from 'lucide-react';
import { useCall } from '../../context/CallContext';
import './CallModal.css';

export const IncomingCallModal: React.FC = () => {
  const { callState, incomingCall, acceptCall, rejectCall } = useCall();

  if (callState !== 'ringing' || !incomingCall) {
    return null;
  }

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const isVideo = incomingCall.call_type === 'video';

  return (
    <div className="call-overlay incoming-call-overlay">
      <div className="call-modal incoming-call-card">
        <div className="incoming-avatar-wrap">
          <div className="incoming-ripple" />
          <div className="incoming-ripple delay-1" />
          <div className="incoming-avatar">
            {incomingCall.caller.avatar ? (
              <img src={incomingCall.caller.avatar} alt={incomingCall.caller.name} />
            ) : (
              <span>{getInitials(incomingCall.caller.name)}</span>
            )}
          </div>
        </div>

        <div className="incoming-info">
          <span className="incoming-badge">
            {isVideo ? <Video size={13} /> : <Mic size={13} />}
            {isVideo ? 'Incoming Video Call' : 'Incoming Voice Call'}
          </span>
          <h3 className="incoming-caller-name">{incomingCall.caller.name}</h3>
          <p className="incoming-subtitle">is calling you in Syncora...</p>
        </div>

        <div className="incoming-actions">
          <button className="call-btn-reject" onClick={() => rejectCall('declined')} title="Decline Call">
            <PhoneOff size={22} />
            <span>Decline</span>
          </button>
          <button className="call-btn-accept" onClick={() => acceptCall()} title="Accept Call">
            <Phone size={22} />
            <span>Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;
