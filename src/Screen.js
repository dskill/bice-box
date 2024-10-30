import React from 'react';
import './App.css';

function Screen()
{


    return (

        <div style={{ width: 362, height: 240, position: 'relative' }}>
            <div style={{ width: 284, height: 133, left: 78, top: 107, position: 'absolute', background: '#D6EEFA', borderRadius: 16 }} />
            <div style={{ left: 93, top: 94, position: 'absolute', color: '#497EA4', fontSize: 64, fontFamily: 'Kanit', fontWeight: '500', wordWrap: 'break-word' }}>01</div>
            <div style={{ left: 93, top: 168, position: 'absolute', color: '#497EA4', fontSize: 24, fontFamily: 'Kanit', fontWeight: '500', wordWrap: 'break-word' }}>LOOPED</div>
            <div style={{ left: 94, top: 211, position: 'absolute', color: '#497EA4', fontSize: 15, fontFamily: 'Haettenschweiler', fontWeight: '400', wordWrap: 'break-word' }}>6:00</div>
            <div style={{ left: 291, top: 211, position: 'absolute', color: '#497EA4', fontSize: 15, fontFamily: 'Haettenschweiler', fontWeight: '400', wordWrap: 'break-word' }}>MFX:REVER8</div>
            <div style={{ left: 293, top: 180, position: 'absolute', color: '#497EA4', fontSize: 14, fontFamily: 'Kanit', fontWeight: '500', wordWrap: 'break-word' }}>Kiasmos</div>
            <div style={{ left: 0, top: 0, position: 'absolute', color: '#F5F5F5', fontSize: 50, fontFamily: 'Haettenschweiler', fontWeight: '400', wordWrap: 'break-word' }}>BOSS</div>
            <div style={{ width: 7, height: 8, left: 118, top: 217, position: 'absolute', background: '#497EA4' }}></div>
        </div>
    );
}

export default Screen;

