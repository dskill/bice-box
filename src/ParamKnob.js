import React, { useState, useEffect } from 'react';
import { Knob } from 'react-rotary-knob';
import * as skins from 'react-rotary-knob-skin-pack';
import useSuperCollider from './hooks/useSuperCollider';

const ParamKnob = ({ synthName, param }) => {
  const { name, value, range } = param;
  const { sendCode } = useSuperCollider();

  // Convert the parameter value to a knob value (rescaled between 0 and 10)
  const paramValueToKnobValue = (val) => {
    const normalized = (val - range[0]) / (range[1] - range[0]);
    return normalized * 10;
  };

  // Convert the knob value (rescaled between 0 and 10) to the parameter value
  const knobValueToParamValue = (knobValue) => {
    const normalized = knobValue / 10;
    return range[0] + normalized * (range[1] - range[0]);
  };

  // State to control the knob's value, initialized based on the initial parameter value
  const [knobValue, setKnobValue] = useState(() => paramValueToKnobValue(value));

  const handleOnChange = (newValue) => {
    // Calculate the maximum distance allowed for the change
    const maxDistance = 10 * 0.2; // Adjust the 0.2 factor as needed

    // Calculate the actual distance in knob value terms
    let distance = Math.abs(newValue - knobValue);

    if (distance > maxDistance) {
      return;
    } else {
      setKnobValue(newValue); // Update the state to change the knob's visual position

      // Convert the knob value back to the parameter's actual range
      const scaledValue = knobValueToParamValue(newValue);

      // Send the value to SuperCollider
      const scCode = `~${synthName}.set(\\${name}, ` + scaledValue + ")";
      sendCode(scCode);
    }
  };

  // Effect to update the knob's position when the param.value changes externally
  useEffect(() => {
    setKnobValue(paramValueToKnobValue(value));
  }, [value, range]);

  return (
    <div className="knob-container">
      <Knob 
        skin={skins.s12}
        min={0}
        max={10}
        value={knobValue}
        unlockDistance={0}
        preciseMode={false}
        onChange={handleOnChange}
        clampMin={0}
        clampMax={10}
        rotateDegrees={180}
        style={{ width: '100px', height: '100px' }} // Set the size of the knob to 200px
      />
      <div className="knob-label">{name}</div>
    </div>
  );
};

export default ParamKnob;
