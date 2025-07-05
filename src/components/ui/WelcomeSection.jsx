const WelcomeSection = ({ userName, onCreateEvent }) => {
    const padText = (text, length) => {
        if (!text) return ''.padEnd(length, ' ');
        if (text.length > length) {
            return text.substring(0, length - 3) + '...';
        }
        return text.padEnd(length, ' ');
    };

    return(
        <>
            <div>|      <span className="card-text" > {padText(`Welcome back, ${userName}`,30)}  </span>     |</div>
            <div>|                                            |</div>
            <div>|  +--------------------------------------+  |</div>
            <div>|  |        <span className="clickable create-event-link" onClick={onCreateEvent}>+ CREATE NEW EVENT</span>            |  |</div>
            <div>|  +--------------------------------------+  |</div>
            <div>|                                            |</div>
            <div>|--------------------------------------------|</div>
            <div>|                                            |</div>
        </>
    )
};

export default WelcomeSection;