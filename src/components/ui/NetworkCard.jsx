import React from 'react';

const NetworkCard = ({ userInfo, isSelected, onCardClick }) => {
    return (
        <div  className="clickable" onClick={() => onCardClick(userInfo)}>
            <div>|  +--------------------------------------+  |</div>
           <div  className={`user-info ${isSelected ? 'selected-id' : ''}`}>| <span className="selection-indicator"> |   {isSelected ? userInfo.id : '○'} </span>   <span className={`selection-indicator ${isSelected ? 'selected-user' : ''}`}></span> <span className="card-text">{userInfo.name}</span> <span className="card-text">{userInfo.username}</span> </div>
            <div>|  +--------------------------------------+  |</div>
            <div>|                                            |</div>
             <style>{`
    
                .selection-indicator {
                    margin-right: 10px;
                    font-weight: bold;
                    text-color: green;
                }
                
                .card-text {
                    margin-right: 15px;
                }

                .selected-id {
                    color: green;
                    font-weight: bold;
                }
            `}</style>
        </div>
        
    );
};

export default NetworkCard;