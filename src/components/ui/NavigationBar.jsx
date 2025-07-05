// Component for the bottom navigation bar
const NavigationBar = ({ onSetActive }) => (
    <>
        <div>+--------------------------------------------+</div>
        <div> <span className="nav-item" onClick={e => onSetActive(e.target, 'HOME')}>[HOME]</span> <span className="nav-item" onClick={e => onSetActive(e.target, 'MY EVENTS')}>[MY EVENTS]</span>  <span className="nav-item" onClick={e => onSetActive(e.target, 'DISCOVER')}>[DISCOVER]</span> <span className="nav-item active" onClick={e => onSetActive(e.target, 'PROFILE')}>[PROFILE]</span> </div>
        <div>+--------------------------------------------+</div>
    </>
);

export default NavigationBar;