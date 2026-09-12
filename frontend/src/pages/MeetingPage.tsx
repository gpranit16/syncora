import React from 'react';
import { useParams } from 'react-router-dom';
import { useMeeting } from '../context/MeetingContext';
import { PreJoinScreen } from '../components/Meetings/PreJoinScreen';
import { MeetingRoom } from '../components/Meetings/MeetingRoom';

export const MeetingPage: React.FC = () => {
  const { meetingCode } = useParams<{ meetingCode: string }>();
  const { meetingStatus } = useMeeting();

  if (!meetingCode) {
    return (
      <div style={{ padding: 40, color: '#fff', textAlign: 'center' }}>
        <h2>Invalid Meeting Link</h2>
      </div>
    );
  }

  if (meetingStatus === 'in_meeting') {
    return <MeetingRoom />;
  }

  return <PreJoinScreen meetingCode={meetingCode} />;
};
