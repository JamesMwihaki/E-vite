import React, { useState } from 'react';
import MoreEventDetails from './MoreEventDetails';

const EventCard = ({ event, isPrivate = false, onRSVP, rsvpStatus, participants }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Handlers now directly call the parent's onRSVP function
    const handleWillAttendChange = (checked) => {
        onRSVP(event.id, checked ? 'yes' : 'none');
    };

    const handleWillNotAttendChange = (checked) => {
        onRSVP(event.id, checked ? 'no' : 'none');
    };
    
    // Toggle expansion without affecting RSVP
    const handleCardClick = () => {
        setIsExpanded(prev => !prev);
    };

    const padText = (text, length) => {
        if (!text) return ''.padEnd(length, ' ');
        if (text.length > length) {
            return text.substring(0, length - 3) + '...';
        }
        return text.padEnd(length, ' ');
    };

    return (
        // Note: The onClick here will toggle details for the whole card.
        // Clicks on checkboxes will be handled separately.
        <div>
            <div className="clickable" onClick={handleCardClick}>
                <div>|  +--------------------------------------+  |</div>
                <div>|  |     <span className="card-text">{padText(`${event.name}`, 30)}</span>   |  |</div>
                <div>|  |     <span className="card-text">{padText(`Location: ${event.location}`, 30)}</span>   |  |</div>
                <div>|  |     <span className="card-text">{padText(`Date:  ${new Date(event.event_date).toLocaleDateString()}`, 30)}</span>   |  |</div>
                <div>|  |     <span className="card-text">{padText(`Description:  ${event.description}`, 30)}</span>   |  |</div>
            </div>

            {/* Pass the participants list down to MoreEventDetails */}
            {isExpanded && <MoreEventDetails event={event} participants={participants} />}

            {isPrivate && (
                <>
                    <div>|  |        <span className="card-text"> [  RSVP ]</span>                    |  |</div>
                    <div>|  |   <label className="checkbox-option">
                                  {/* Checkbox state is now controlled by the rsvpStatus prop */}
                                  <input 
                                      type="checkbox" 
                                      className="box" 
                                      checked={rsvpStatus === 'going'} 
                                      onChange={(e) => handleWillAttendChange(e.target.checked)} 
                                  /> 
                                  <span className="card-text">Yes I will be attending</span>
                              </label>         |  |</div>
                    <div>|  |   <label className="checkbox-option">
                                  <input 
                                      type="checkbox" 
                                      className="box" 
                                      checked={rsvpStatus === 'not_going'} 
                                      onChange={(e) => handleWillNotAttendChange(e.target.checked)} 
                                  /> 
                                  <span className="card-text"> will not be attending </span>
                              </label>         |  |</div>
                </>
            )}
            <div>|  +--------------------------------------+  |</div>
            <div>|                                            |</div>
            <style>
            {`
            .checkbox-option{
                margin: .5px;
            }
            
            `}</style>
        </div>
    );
};

export default EventCard;