/*
  (C) 2014 David Lettier
  lettier.com
*/

// The canvas.

var canvas;

// The WebGL context.

var gl;

// The eventual compiled and linked vertex and fragment shader program.

var shaderProgram;

// A stack for preserving matrix transformation states.

var model_matrix_stack = [ ];

// The view, model, model-view, and projection matrices.

var view_matrix  = mat4.create( );
var model_matrix = mat4.create( );
var mvMatrix     = mat4.create( );
var pMatrix      = mat4.create( );

// For use in the opening camera move animation.

var opening_animation_complete = false;

// Mouse pointer locked?

var acquired_pointer_lock = false;

// Camera controls.

var use_controls = false;

var camera_position_vector           = vec3.set( vec3.create( ), 0, 0.9, 0 );
var original_camera_direction_vector = vec3.set( vec3.create( ), 1,   0, 0 );
var camera_up_vector                 = vec3.set( vec3.create( ), 0,   1, 0 );

var camera_direction_vector          = vec3.clone( original_camera_direction_vector );
var camera_sideways_vector           = vec3.cross( vec3.create( ), camera_direction_vector, camera_up_vector );

var camera_pitch = 0.0;
var camera_yaw   = 0.0;

//        W,    S,    A,     D,  Z,    X
//  Forward, Back, Left, Right, Up, Down
// Index: 0     1     2      3,  4,    5

var camera_keys = [ 0, 0, 0, 0, 0, 0 ];

// The following is used to calculate the mouse-x and mouse-y delta values
// when the mouse pointer lock API isn't available.

var previous_mouse_coordinates = [ 0, 0 ];

// These two arrays will act like a queue buffer.
// By taking the average of all values in the buffer,
// it will smooth the camera yaw and pitch movement.
// The mouse-move event callback will fill the buffer
// and the draw scene function will empty the buffer.

var mouse_x_deltas = [ ];
var mouse_y_deltas = [ ];

// The maximum buffer sizes.

// Increasing these values will produce a larger lag in the camera yaw and pitch movement.
// Decreasing these values will produce a smaller lag in the camera yaw and pitch movement.

var max_mouse_x_deltas = 5;
var max_mouse_y_deltas = 5;

// Sierpinski pyramid data structures for holding the vertices, vertex normals, and vertex colors.

var pyramidVertexPositionBuffer;
var pyramidVertexNormalBuffer;
var pyramidVertexColorBuffer;

// Cube data structures for holding the vertices, vertex normals, vertex colors, and vertex indices.

var cubeVertexPositionBuffer;
var cubeVertexNormalBuffer;
var cubeVertexColorBuffer;
var cubeVertexIndexBuffer;

// Used for time based animation.

var time_last = 0;

// Used to rotate the pyramids.

var rotation_radians      = 0.0;
var rotation_radians_step = 0.17;

// Number of times to subdivide the Sierpinski pyramid.

var subdivide_count = 2;

// Maximum number of subdivides.

var max_subdivide_count = 7;

// Performs the draw loop iteration at roughly 60 frames per second.

window.requestAnimationFrame = window.requestAnimationFrame       ||
                               window.mozRequestAnimationFrame    ||
                               window.webkitRequestAnimationFrame ||
                               window.msRequestAnimationFrame;

// On-load event callback.

window.onload = function ( ) {
  var gui = new dat.GUI();

  var subdivide_count_controller =
    gui.add(this, "subdivide_count", 0, max_subdivide_count).step(1).listen();

  subdivide_count_controller
    .onChange(function (value) { initBuffers( ); });

  webGLStart( );
};

// Browser window re-size event callback.

window.onresize = function ( ) { resize_contents( ); };

// Initializes the WebGL context.

function initGL( canvas )
{

  try
  {

    gl = canvas.getContext( "webgl",              { premultipliedAlpha: false } ) ||
         canvas.getContext( "experimental-webgl", { premultipliedAlpha: false } );
    gl.viewportWidth  = canvas.width;
    gl.viewportHeight = canvas.height;

  }
  catch ( error )
  {

    // Browser cannot initialize a WebGL context.

    window.location.assign( "http://get.webgl.org/" );

  }

  if ( !gl )
  {

    // Browser cannot initialize a WebGL context.

    window.location.assign( "http://get.webgl.org/" );

  }

}

// Function to retrieve the shader strings thereby compiling them into shader programs run by the GPU.

function getShader( gl, id )
{
  var shaderScript = document.getElementById( id );

  if ( !shaderScript )
  {

    console.error( "No shader scripts present." );

    return null;

  }

  var str = "";

  var k = shaderScript.firstChild;

  while ( k )
  {

    if ( k.nodeType == 3 )
    {

      str += k.textContent;

    }

    k = k.nextSibling;

  }

  var shader = null;

  if ( shaderScript.type == "x-shader/x-fragment" )
  {

    shader = gl.createShader( gl.FRAGMENT_SHADER );

  }
  else if ( shaderScript.type == "x-shader/x-vertex" )
  {

    shader = gl.createShader( gl.VERTEX_SHADER );

  }
  else
  {

    console.error( "No fragment/vertex shaders found." );

    return null;

  }

  gl.shaderSource( shader, str );
  gl.compileShader( shader );

  if ( !gl.getShaderParameter( shader, gl.COMPILE_STATUS ) )
  {

    console.error( gl.getShaderInfoLog( shader ) );

    return null;

  }

  return shader;

}

// Initialize the vertex and fragment shaders.

function initShaders( )
{

  var fragmentShader = getShader( gl, "shader-fs" );
  var vertexShader   = getShader( gl, "shader-vs" );

  shaderProgram = gl.createProgram( );
  gl.attachShader( shaderProgram, vertexShader );
  gl.attachShader( shaderProgram, fragmentShader );
  gl.linkProgram( shaderProgram );

  if ( !gl.getProgramParameter( shaderProgram, gl.LINK_STATUS ) )
  {

    console.error( "Could not initialize shaders." );

  }

  gl.useProgram( shaderProgram );

  // Acquire handles to shader program variables in order to pass data to the shaders.

  shaderProgram.vertexPositionAttribute = gl.getAttribLocation( shaderProgram, "aVertexPosition" );
  gl.enableVertexAttribArray( shaderProgram.vertexPositionAttribute );

  shaderProgram.vertexColorAttribute = gl.getAttribLocation( shaderProgram, "aVertexColor" );
  gl.enableVertexAttribArray( shaderProgram.vertexColorAttribute );

  shaderProgram.vertexNormalAttribute = gl.getAttribLocation( shaderProgram, "aVertexNormal" );
  gl.enableVertexAttribArray( shaderProgram.vertexNormalAttribute );

  shaderProgram.pMatrixUniform  = gl.getUniformLocation( shaderProgram, "uPMatrix"  );
  shaderProgram.mvMatrixUniform = gl.getUniformLocation( shaderProgram, "uMVMatrix" );
  shaderProgram.nMatrixUniform  = gl.getUniformLocation( shaderProgram, "uNMatrix"  );

  shaderProgram.ambientColorUniform       = gl.getUniformLocation( shaderProgram, "uAmbientColor"       );
  shaderProgram.pointLightLocationUniform = gl.getUniformLocation( shaderProgram, "uPointLightLocation" );
  shaderProgram.pointLightColorUniform    = gl.getUniformLocation( shaderProgram, "uPointLightColor"    );
  shaderProgram.screenSizeUniform         = gl.getUniformLocation( shaderProgram, "uSreenSize"          );

}

// Initialize all of the vertex, vertex normals, vertex colors, and vertex indice buffers.

function initBuffers( )
{

  // Finds the midpoint between two points which form an edge of the tetrahedron.

  function midpoint( one, two )
  {

    var point = [ ( one[ 0 ] + two[ 0 ] ) / 2.0, ( one[ 1 ] + two[ 1 ] ) / 2.0, ( one[ 2 ] + two[ 2 ] ) / 2.0  ];

    return point;

  }

  // Generates one triangle face to the tetrahedron

  function triangle( p1, p2, p3, c1, c2, c3, smooth )
  {

    // Push the vertices to this triangle in counter-clockwise order.
    //
    //    1.....4
    //   . .   . .
    //  .   . .   .
    // 3.....2.....5
    //
    // 1 then 2 then 3 would be clockwise order.
    // 3 then 2 then 1 would be counter-closewise order.

    // WebGL default for the front of the face of the triangle is counter-clockwise order.
    // Thus push 3, 2, and then 1 in that order.

    vertices.push( p3[ 0 ] ); vertices.push( p3[ 1 ] ); vertices.push( p3[ 2 ] );
    vertices.push( p2[ 0 ] ); vertices.push( p2[ 1 ] ); vertices.push( p2[ 2 ] );
    vertices.push( p1[ 0 ] ); vertices.push( p1[ 1 ] ); vertices.push( p1[ 2 ] );

    // Push the vertex colors for this triangle face.

    vertex_colors.push( c3[ 0 ] ); vertex_colors.push( c3[ 1 ] ); vertex_colors.push( c3[ 2 ] ); vertex_colors.push( 1.0 );
    vertex_colors.push( c2[ 0 ] ); vertex_colors.push( c2[ 1 ] ); vertex_colors.push( c2[ 2 ] ); vertex_colors.push( 1.0 );
    vertex_colors.push( c1[ 0 ] ); vertex_colors.push( c1[ 1 ] ); vertex_colors.push( c1[ 2 ] ); vertex_colors.push( 1.0 );

    // Compute this triangle face's face normal for use in the lighting calculations.

    var triangle_side_u = [ p2[ 0 ] - p1[ 0 ], p2[ 1 ] - p1[ 1 ], p2[ 2 ] - p1[ 2 ] ];
    var triangle_side_v = [ p3[ 0 ] - p1[ 0 ], p3[ 1 ] - p1[ 1 ], p3[ 2 ] - p1[ 2 ] ];

    // Cross product N = U x V where U = <x1,y1,z1> and V = <x2,y2,z2>.

    // Nx = ( z1 * y2 ) - ( y1 * z2 )
    // Ny = ( x1 * z2 ) - ( z1 * x2 )
    // Nz = ( y1 * x2 ) - ( x1 * y2 )

    var face_normal_x = ( triangle_side_u[ 2 ] * triangle_side_v[ 1 ] ) - ( triangle_side_u[ 1 ] * triangle_side_v[ 2 ] );
    var face_normal_y = ( triangle_side_u[ 0 ] * triangle_side_v[ 2 ] ) - ( triangle_side_u[ 2 ] * triangle_side_v[ 0 ] );
    var face_normal_z = ( triangle_side_u[ 1 ] * triangle_side_v[ 0 ] ) - ( triangle_side_u[ 0 ] * triangle_side_v[ 1 ] );

    var length = Math.sqrt( ( face_normal_x * face_normal_x ) + ( face_normal_y * face_normal_y ) + ( face_normal_z * face_normal_z ) );

    // Normalize this face normal.

    if ( length !== 0.0 )
    {

      face_normal_x = face_normal_x / length;
      face_normal_y = face_normal_y / length;
      face_normal_z = face_normal_z / length;

    }

    // Use the face normal of this triangle face as the vertex normal for all of the vertex normals
    // that make up this triangle face. These vertex normals will be used in the lighting calculations.
    // Instead, to compute the vertex normals, you could average all of the face normals that are adjacent
    // to a particular vertex as the vertex normal. This would provide a smooth surface appearance.

    if ( smooth === false )
    {

      vertex_normals.push( face_normal_x ); vertex_normals.push( face_normal_y ); vertex_normals.push( face_normal_z );
      vertex_normals.push( face_normal_x ); vertex_normals.push( face_normal_y ); vertex_normals.push( face_normal_z );
      vertex_normals.push( face_normal_x ); vertex_normals.push( face_normal_y ); vertex_normals.push( face_normal_z );

    }

    // Return the face normal to later compute the average of all the face normals that are adjacent to a particular vertex.

    return [ face_normal_x, face_normal_y, face_normal_z ];

  }

  function weighted_vertex_normal( v, fN1, fN2, fN3 )
  {

    // Sum all of the face normals adjacent to this vertex component wise.

    var face_normal_sum = [ fN1[ 0 ] + fN2[ 0 ] + fN3[ 0 ], fN1[ 1 ] + fN2[ 1 ] + fN3[ 1 ], fN1[ 2 ] + fN2[ 2 ] + fN3[ 2 ] ];

    // Compute the average.

    var face_normal_average = [ face_normal_sum[ 0 ] / 3.0, face_normal_sum[ 1 ] / 3.0, face_normal_sum[ 2 ] / 3.0 ];

    // Normalize the average.

    var length = Math.sqrt( ( face_normal_average[ 0 ] * face_normal_average[ 0 ] ) + ( face_normal_average[ 1 ] * face_normal_average[ 1 ] ) + ( face_normal_average[ 2 ] * face_normal_average[ 2 ] ) );

    if ( length !== 0.0 )
    {

      face_normal_average[ 0 ] =  face_normal_average[ 0 ] / length;
      face_normal_average[ 1 ] =  face_normal_average[ 1 ] / length;
      face_normal_average[ 2 ] =  face_normal_average[ 2 ] / length;

    }

    // This vertex normal is the normalized average of all the face normals that are adjacent to this vertex.

    vertex_normals.push( face_normal_average[ 0 ] ); vertex_normals.push( face_normal_average[ 1 ] ); vertex_normals.push( face_normal_average[ 2 ] );

  }

  function tetrahedron( p1, p2, p3, p4, c1, c2, c3, c4, smooth )
  {

    var fN1 = triangle( p1, p2, p3, c1, c2, c3, smooth ); // Front face.
    var fN2 = triangle( p1, p4, p2, c1, c2, c4, smooth ); // Right face.
    var fN3 = triangle( p1, p3, p4, c1, c3, c4, smooth ); // Left face.
    var fN4 = triangle( p2, p4, p3, c2, c3, c4, smooth ); // Bottom face.

    // Compute and add the vertex normals using the face normals returned.
    // These vertex normals will be used for the lighting calculations
    // making for a smooth appearance.

    if ( smooth === true )
    {

      // Compute in counter-clockwise order since the vertices
      // were added in counter-clockwise order.

      weighted_vertex_normal( p3, fN1, fN3, fN4 );
      weighted_vertex_normal( p2, fN1, fN4, fN2 );
      weighted_vertex_normal( p1, fN1, fN2, fN3 );

      weighted_vertex_normal( p2, fN1, fN4, fN2 );
      weighted_vertex_normal( p4, fN2, fN4, fN3 );
      weighted_vertex_normal( p1, fN1, fN2, fN3 );

      weighted_vertex_normal( p4, fN2, fN4, fN3 );
      weighted_vertex_normal( p3, fN1, fN3, fN4 );
      weighted_vertex_normal( p1, fN1, fN2, fN3 );

      weighted_vertex_normal( p3, fN1, fN3, fN4 );
      weighted_vertex_normal( p4, fN2, fN4, fN3 );
      weighted_vertex_normal( p2, fN1, fN4, fN2 );

    }

  }


  function divide_tetrahedron( p1, p2, p3, p4, c1, c2, c3, c4, count, smooth )
  {

    // If the subdivision count is greater than zero.

    if ( count > 0 )
    {

      // Find the midpoints to all of the edges of this pyramid/tetrahedron.

      var p1_p2 = midpoint( p1, p2 );
      var p1_p3 = midpoint( p1, p3 );
      var p1_p4 = midpoint( p1, p4 );
      var p2_p3 = midpoint( p2, p3 );
      var p2_p4 = midpoint( p2, p4 );
      var p3_p4 = midpoint( p3, p4 );

      // Subdivide the vertex colors as well--similar to subdividing the edges.

      var c1_c2 = midpoint( c1, c2 );
      var c1_c3 = midpoint( c1, c3 );
      var c1_c4 = midpoint( c1, c4 );
      var c2_c3 = midpoint( c2, c3 );
      var c2_c4 = midpoint( c2, c4 );
      var c3_c4 = midpoint( c3, c4 );

      // Each subdivision of a tetrahedron/pyramid produces four new pyramids from the subdivided pyramid.
      // One on top and three on the bottom.

      // Four recursive calls.

      divide_tetrahedron( p1,    p1_p2, p1_p3, p1_p4, c1,    c1_c2, c1_c3, c1_c4, count - 1, smooth );
      divide_tetrahedron( p1_p2, p2,    p2_p3, p2_p4, c1_c2, c2,    c2_c3, c2_c4, count - 1, smooth );
      divide_tetrahedron( p1_p3, p2_p3, p3,    p3_p4, c1_c3, c2_c3, c3,    c3_c4, count - 1, smooth );
      divide_tetrahedron( p1_p4, p2_p4, p3_p4, p4,    c1_c4, c2_c4, c3_c4, c4,    count - 1, smooth );

    }
    else
    {

      // No more subdivision, so assemble this tetrahedron/pyramid.
      // The recursive base case.

      tetrahedron( p1, p2, p3, p4, c1, c2, c3, c4, smooth );

    }

  }

  // Begin creating the Sierpinski pyramid.

  // Dimension of the Sierpinski tetrahedron.

  var r = 3;

  // The main points of the Sierpinski tetrahedron.

  var a = 0;
  var b = r;
  var c = b * Math.sqrt( 2 ) * 2.0 / 3.0;
  var d = -1 * b / 3.0;
  var e = -1 * b * Math.sqrt( 2 ) / 3.0;
  var f = b * Math.sqrt( 2 ) / Math.sqrt( 3 );
  var g = -1 * f;

  var point_one   = [ a, b, a ];
  var point_two   = [ c, d, a ];
  var point_three = [ e, d, f ];
  var point_four  = [ e, d, g ];

  // Vertex colors of the four main points of the Sierpinski tetrahedron/pyramid.

  var color_one   = [ 0.212, 0.816, 0.678 ];
  var color_two   = [ 0.267, 0.498, 0.820 ];
  var color_three = [ 1.0,   0.722, 0.259 ];
  var color_four  = [ 1.0,   0.541, 0.259 ];

  // Temporary arrays to hold all of the data that will be read into the buffers.

  var vertices       = [ ];
  var vertex_normals = [ ];
  var vertex_colors  = [ ];

  subdivide_count = Math.floor(subdivide_count);

  divide_tetrahedron(

    point_one,
    point_two,
    point_three,
    point_four,
    color_one,
    color_two,
    color_three,
    color_four,
    subdivide_count,
    false

  );

  // Create the vertex buffer and bind it getting it ready to read in the vertices to the tetrahedron/pyramid.

  pyramidVertexPositionBuffer = gl.createBuffer( );
  gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexPositionBuffer );

  // Bind and fill the pyramid vertices.

  gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( vertices ), gl.STATIC_DRAW );
  pyramidVertexPositionBuffer.itemSize = 3;
  pyramidVertexPositionBuffer.numItems = vertices.length / 3;

  // Bind and fill the pyramid vertex normals.

  pyramidVertexNormalBuffer = gl.createBuffer( );
  gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexNormalBuffer );
  gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( vertex_normals ), gl.STATIC_DRAW );
  pyramidVertexNormalBuffer.itemSize = 3;
  pyramidVertexNormalBuffer.numItems = vertex_normals.length / 3;

  // Bind and fill the pyramid vertex colors.

  pyramidVertexColorBuffer = gl.createBuffer( );
  gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexColorBuffer );
  gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( vertex_colors ), gl.STATIC_DRAW );
  pyramidVertexColorBuffer.itemSize = 4;
  pyramidVertexColorBuffer.numItems = vertex_colors.length / 4;

  // Begin creating the cube.
  // This cube gives a visual representation to the unseen point light in the rendering.

  cubeVertexPositionBuffer = gl.createBuffer( );
  gl.bindBuffer( gl.ARRAY_BUFFER, cubeVertexPositionBuffer );

  vertices = [

    // Front face.
    -1.0, -1.0,  1.0,
     1.0, -1.0,  1.0,
     1.0,  1.0,  1.0,
    -1.0,  1.0,  1.0,

    // Back face.
    -1.0, -1.0, -1.0,
    -1.0,  1.0, -1.0,
     1.0,  1.0, -1.0,
     1.0, -1.0, -1.0,

    // Top face.
    -1.0,  1.0, -1.0,
    -1.0,  1.0,  1.0,
     1.0,  1.0,  1.0,
     1.0,  1.0, -1.0,

    // Bottom face.
    -1.0, -1.0, -1.0,
     1.0, -1.0, -1.0,
     1.0, -1.0,  1.0,
    -1.0, -1.0,  1.0,

    // Right face.
     1.0, -1.0, -1.0,
     1.0,  1.0, -1.0,
     1.0,  1.0,  1.0,
     1.0, -1.0,  1.0,

    // Left face.
    -1.0, -1.0, -1.0,
    -1.0, -1.0,  1.0,
    -1.0,  1.0,  1.0,
    -1.0,  1.0, -1.0,

  ];

  vertex_colors = [

    // Front face.
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,

    // Back face.
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,

    // Top face.
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,

    // Bottom face.
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,

    // Right face.
    1.0, 0.796, 0.671, 1.0,
    1.0, 0.796, 0.671, 1.0,
    1.0, 0.796, 0.671, 1.0,
    1.0, 0.796, 0.671, 1.0,

    // Left face.
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,
    0.5, 0.5, 0.7, 1.0,

  ];

  vertex_normals = [

    // Front face.
    0.0,  0.0,  1.0,
    0.0,  0.0,  1.0,
    0.0,  0.0,  1.0,
    0.0,  0.0,  1.0,

    // Back face.
    0.0,  0.0, -1.0,
    0.0,  0.0, -1.0,
    0.0,  0.0, -1.0,
    0.0,  0.0, -1.0,

    // Top face.
    0.0,  1.0,  0.0,
    0.0,  1.0,  0.0,
    0.0,  1.0,  0.0,
    0.0,  1.0,  0.0,

    // Bottom face.
    0.0, -1.0,  0.0,
    0.0, -1.0,  0.0,
    0.0, -1.0,  0.0,
    0.0, -1.0,  0.0,

    // Right face.
    1.0,  0.0,  0.0,
    1.0,  0.0,  0.0,
    1.0,  0.0,  0.0,
    1.0,  0.0,  0.0,

    // Left face.
    -1.0,  0.0,  0.0,
    -1.0,  0.0,  0.0,
    -1.0,  0.0,  0.0,
    -1.0,  0.0,  0.0,

  ];

  var vertex_indices = [

    0,   1,  2,    0,  2,  3, // Front face.
    4,   5,  6,    4,  6,  7, // Back face.
    8,   9, 10,    8, 10, 11, // Top face.
    12, 13, 14,   12, 14, 15, // Bottom face.
    16, 17, 18,   16, 18, 19, // Right face.
    20, 21, 22,   20, 22, 23  // Left face.

  ];

  // Bind and fill the cube's buffers.

  gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( vertices ), gl.STATIC_DRAW );
  cubeVertexPositionBuffer.itemSize = 3;
  cubeVertexPositionBuffer.numItems = vertices.length / 3;

  cubeVertexNormalBuffer = gl.createBuffer( );
  gl.bindBuffer( gl.ARRAY_BUFFER, cubeVertexNormalBuffer );

  gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( vertex_normals ), gl.STATIC_DRAW );
  cubeVertexNormalBuffer.itemSize = 3;
  cubeVertexNormalBuffer.numItems = vertex_normals.length / 3;

  cubeVertexColorBuffer = gl.createBuffer( );
  gl.bindBuffer( gl.ARRAY_BUFFER, cubeVertexColorBuffer );

  gl.bufferData( gl.ARRAY_BUFFER, new Float32Array( vertex_colors ), gl.STATIC_DRAW );
  cubeVertexColorBuffer.itemSize = 4;
  cubeVertexColorBuffer.numItems = vertex_colors.length / 4;

  cubeVertexIndexBuffer = gl.createBuffer();
  gl.bindBuffer( gl.ELEMENT_ARRAY_BUFFER, cubeVertexIndexBuffer );

  gl.bufferData( gl.ELEMENT_ARRAY_BUFFER, new Uint16Array( vertex_indices ), gl.STATIC_DRAW );
  cubeVertexIndexBuffer.itemSize = 1;
  cubeVertexIndexBuffer.numItems = vertex_indices.length;

}

function initControls( )
{

  // Camera controls.

  window.onkeydown = function ( event ) {

    switch ( event.keyCode ) {

      case 87: // Forward W

        camera_keys[ 0 ] = 1;

        break;

      case 83: // Backward S

        camera_keys[ 1 ] = 1;

        break;

      case 65: // Left A

        camera_keys[ 2 ] = 1;

        break;

      case 68: // Right D

        camera_keys[ 3 ] = 1;

        break;

      case 90: // Up Z

        camera_keys[ 4 ] = 1;

        break;

      case 88: // Down X

        camera_keys[ 5 ] = 1;

        break;

      default:

        break;

    }

  };

  window.onkeyup = function ( event ) {

    switch ( event.keyCode ) {

      case 87: // Forward W

        camera_keys[ 0 ] = 0;

        break;

      case 83: // Backward S

        camera_keys[ 1 ] = 0;

        break;

      case 65: // Left A

        camera_keys[ 2 ] = 0;

        break;

      case 68: // Right D

        camera_keys[ 3 ] = 0;

        break;

      case 90: // Up Z

        camera_keys[ 4 ] = 0;

        break;

      case 88: // Down X

        camera_keys[ 5 ] = 0;

        break;

      case 77: // Use Controls M

        use_controls = !use_controls;

        if ( use_controls )
        {

          canvas.requestPointerLock( );

          document.addEventListener( "mousemove", mouse_move, false );

          document.addEventListener( "mouseup", mouse_button_up, false );

        }
        else
        {

          document.exitPointerLock( );

          document.removeEventListener( "mousemove", mouse_move, false );

          document.removeEventListener( "mouseup", mouse_button_up, false );

        }

        break;

      default:

        break;

    }

  };

  // The following is for locking the mouse pointer if possible.
  // The mouse pointer lock API is not available in all browsers.

  function pointer_lock_change( )
  {

    if ( document.pointerLockElement       === canvas ||
         document.mozPointerLockElement    === canvas ||
         document.webkitPointerLockElement === canvas    )
    {

      acquired_pointer_lock = true;

      use_controls = true;

      document.addEventListener( "mousemove", mouse_move, false );

      document.addEventListener( "mouseup", mouse_button_up, false );

    }
    else
    {

      acquired_pointer_lock = false;

      use_controls = false;

      document.removeEventListener( "mousemove", mouse_move, false );

      document.removeEventListener( "mouseup", mouse_button_up, false );

    }

  }

  document.addEventListener( "pointerlockchange",       pointer_lock_change, false );
  document.addEventListener( "mozpointerlockchange",    pointer_lock_change, false );
  document.addEventListener( "webkitpointerlockchange", pointer_lock_change, false );

  canvas.requestPointerLock = canvas.requestPointerLock       ||
                              canvas.mozRequestPointerLock    ||
                              canvas.webkitRequestPointerLock ||
                              function ( ) { return null; };

  document.exitPointerLock  = document.exitPointerLock        ||
                              document.mozExitPointerLock     ||
                              document.webkitExitPointerLock  ||
                              function ( ) { return null; };

  // Gather up the changes in the mouse-x and mouse-y dimensions when the user moves the mouse.

  function mouse_move( event )
  {
    var mouse_x_delta;
    var mouse_y_delta;

    if ( use_controls && !acquired_pointer_lock )
    {

      mouse_x_delta = event.clientX - previous_mouse_coordinates[ 0 ];
      mouse_y_delta = event.clientY - previous_mouse_coordinates[ 1 ];

      previous_mouse_coordinates[ 0 ] = event.clientX;
      previous_mouse_coordinates[ 1 ] = event.clientY;

      if ( mouse_x_deltas.length <= max_mouse_x_deltas ) mouse_x_deltas.push( mouse_x_delta );

      if ( mouse_y_deltas.length <= max_mouse_y_deltas ) mouse_y_deltas.push( mouse_y_delta );

    }
    else if ( use_controls && acquired_pointer_lock )
    {

      mouse_x_delta = event.movementX       ||
                      event.mozMovementX    ||
                      event.webkitMovementX ||
                      0;

      mouse_y_delta = event.movementY       ||
                      event.mozMovementY    ||
                      event.webkitMovementY ||
                      0;

      previous_mouse_coordinates[ 0 ] = event.clientX - mouse_x_delta;
      previous_mouse_coordinates[ 1 ] = event.clientY - mouse_y_delta;

      if ( mouse_x_deltas.length <= max_mouse_x_deltas ) mouse_x_deltas.push( mouse_x_delta );

      if ( mouse_y_deltas.length <= max_mouse_y_deltas ) mouse_y_deltas.push( mouse_y_delta );

    }

  }

  // Disable the right click context menu as the right
  // mouse button is being used for another purpose.

  document.oncontextmenu = function ( ) { return false; };

  // Subdivide the pyramids based on mouse left or right button clicks.

  function mouse_button_up( event )
  {

    event.preventDefault( );

    switch ( event.which )
    {

      case 1: // Left button.

        if (subdivide_count < max_subdivide_count) { subdivide_count += 1; initBuffers( ); }

        break;

      case 3: // Right button.

        if (subdivide_count > 0) { subdivide_count -= 1; initBuffers( ); }

        break;

      default:

        break;

    }

    return false;

  }

}

function initHUD( )
{

  // Create and show an onscreen logo.

  var logo_box         = document.createElement( "div" );
  logo_box.id          = "logo_box";
  logo_box.title       = "Lettier";
  logo_box.className   = "logo_box";
  logo_box.innerHTML   = "<img id='logo' src='assets/images/logo.png' class='logo' onclick='window.open(\"http://www.lettier.com/\");'>";
  document.body.appendChild( logo_box );

  var logo_image          = document.getElementById( "logo" );
  logo_image_height       = logo_image.clientHeight * 0.5;
  logo_image_width        = logo_image.clientWidth  * 0.5;
  logo_image.style.height = logo_image_height + "px";
  logo_image.style.width  = logo_image_width  + "px";
  logo_box.style.top      = window.innerHeight - logo_image_height - 10 + "px";
  logo_box.style.left     = window.innerWidth  - logo_image_width  - 10 + "px";

  // Create and show an onscreen instruction text box.
  // Fade it out then remove it.

  var instruction_text_box       = document.createElement( "div" );
  instruction_text_box.id        = "instruction_text_box";
  instruction_text_box.className = "instruction_text_box";
  instruction_text_box.innerHTML = "Press <kbd>M</kbd> to move the camera.";
  document.body.appendChild( instruction_text_box );

  instruction_text_box.style.top  = ( window.innerHeight / 2 ) - ( instruction_text_box.clientHeight / 2 ) + "px";
  instruction_text_box.style.left = ( window.innerWidth  / 2 ) - ( instruction_text_box.clientWidth  / 2 ) + "px";

  var instruction_text_box_opacity = 1.0;

  var instruction_text_box_fade_timer = setInterval( function ( ) {

    if ( instruction_text_box_opacity < 0.01 )
    {

      clearInterval( instruction_text_box_fade_timer );
      document.body.removeChild( instruction_text_box );

    }
    else
    {

      instruction_text_box_opacity -= 0.01;

      instruction_text_box.style.opacity = instruction_text_box_opacity;

    }

  }, 70 );

}

function push_model_matrix( )
{

  // Save the model matrix for later use.

  model_matrix_stack.push( mat4.copy( mat4.create( ), model_matrix ) );

}

function pop_model_matrix( )
{

  // Gather the previously pushed model matrix.

  if ( model_matrix_stack.length === 0 )
  {

    console.error( "Model matrix stack is empty." );

  }

  model_matrix = model_matrix_stack.pop( );
}

// Pass to the vertex shader the needed matrices.

function setMatrixUniforms( )
{

  // Pass the vertex shader the projection matrix and the model-view matrix.

  gl.uniformMatrix4fv( shaderProgram.pMatrixUniform,  false, pMatrix );
  gl.uniformMatrix4fv( shaderProgram.mvMatrixUniform, false, mvMatrix );

  // Pass the vertex normal matrix to the shader so it can compute the lighting calculations.

  var normalMatrix = mat3.create( );
  mat3.normalFromMat4( normalMatrix, mvMatrix );
  gl.uniformMatrix3fv( shaderProgram.nMatrixUniform, false, normalMatrix );

}

// The function renders the scene and moves the camera around based on the user's input.

function draw_scene( timestamp )
{

  // Call this function to draw the next frame.

  window.requestAnimationFrame( draw_scene );

  // Time based animation instead of frame based animation.

  var time_now = new Date( ).getTime( );

  var time_delta = 0.0;

  if ( time_last !== 0.0 )
  {

    time_delta = ( time_now - time_last ) / 1000.0;

  }

  time_last = time_now;

  // Set the size of and clear the render window.

  gl.viewport( 0, 0, gl.viewportWidth, gl.viewportHeight );
  gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

  // Create the perspective matrix.

  var fov_d = 28.0;
  var fov_r = fov_d * ( Math.PI / 180.0 );

  var near = 0.1;
  var far  = 500.0;

  mat4.perspective( pMatrix, fov_r, gl.viewportWidth / gl.viewportHeight, near, far );

  // Move the camera back for a dramatic opening animation.

  if( camera_position_vector[ 0 ] > -5.7 && !opening_animation_complete )
  {

    camera_pitch = 354 * ( Math.PI / 180 );

    vec3.transformMat4(

      camera_direction_vector,
      original_camera_direction_vector,
      mat4.rotate( mat4.create( ), mat4.identity( mat4.create( ) ), camera_pitch, camera_sideways_vector )

    );

    camera_direction_vector = vec3.normalize( camera_direction_vector, camera_direction_vector );

    vec3.sub(

      camera_position_vector,
      camera_position_vector,
      vec3.scale( vec3.create( ), camera_direction_vector, time_delta )

    );

  }
  else
  {

    opening_animation_complete = true;

  }

  if ( opening_animation_complete && use_controls )
  {

    // Calculate the camera yaw and pitch angles.

    if ( !acquired_pointer_lock )
    {

      camera_yaw    += -( get_average( mouse_x_deltas ) * ( Math.PI / 180.0 ) ) * 0.35;
      camera_pitch  += -( get_average( mouse_y_deltas ) * ( Math.PI / 180.0 ) ) * 0.35;

      // Wrap the angles.

      camera_yaw   = get_remainder( camera_yaw,   Math.PI * 2 );
      camera_pitch = get_remainder( camera_pitch, Math.PI * 2 );

      // Limit the pitch angle.

      if ( camera_pitch <= ( 180 * ( Math.PI / 180 ) ) && camera_pitch >= ( 45 * ( Math.PI / 180 ) ) )
      {

        camera_pitch = 45 * ( Math.PI / 180 );

      }

      if ( camera_pitch <= ( 315 * ( Math.PI / 180 ) ) && camera_pitch > ( 180 * ( Math.PI / 180 ) ) )
      {

        camera_pitch = 315 * ( Math.PI / 180 );

      }

      // Remove the first elements from the mouse delta buffers.

      mouse_x_deltas.shift( );
      mouse_y_deltas.shift( );

    }
    else if ( acquired_pointer_lock )
    {

      camera_yaw    += -( get_average( mouse_x_deltas ) * ( Math.PI / 180.0 ) ) * time_delta;
      camera_pitch  += -( get_average( mouse_y_deltas ) * ( Math.PI / 180.0 ) ) * time_delta;

      // Wrap the angles.

      camera_yaw   = get_remainder( camera_yaw,   Math.PI * 2 );
      camera_pitch = get_remainder( camera_pitch, Math.PI * 2 );

      // Limit the pitch angle.

      if ( camera_pitch <= ( 180 * ( Math.PI / 180 ) ) && camera_pitch >= ( 45 * ( Math.PI / 180 ) ) )
      {

        camera_pitch = 45 * ( Math.PI / 180 );

      }

      if ( camera_pitch <= ( 315 * ( Math.PI / 180 ) ) && camera_pitch > ( 180 * ( Math.PI / 180 ) ) )
      {

        camera_pitch = 315 * ( Math.PI / 180 );

      }

      // Remove the first elements from the mouse delta buffers.

      mouse_x_deltas.shift( );
      mouse_y_deltas.shift( );

    }

    // Perform yaw.

    vec3.transformMat4(

      camera_direction_vector,
      original_camera_direction_vector,
      mat4.rotate( mat4.create( ), mat4.identity( mat4.create( ) ), camera_yaw, camera_up_vector )

    );

    camera_direction_vector = vec3.normalize( camera_direction_vector, camera_direction_vector );

    // Perform pitch.

    camera_sideways_vector = vec3.cross( vec3.create( ), camera_direction_vector, camera_up_vector );

    vec3.transformMat4(

      camera_direction_vector,
      camera_direction_vector,
      mat4.rotate( mat4.create( ), mat4.identity( mat4.create( ) ), camera_pitch, camera_sideways_vector )

    );

    camera_direction_vector = vec3.normalize( camera_direction_vector, camera_direction_vector );

    // Forward, backward, left, right, up, and down camera movements.

    if ( camera_keys[ 0 ] )
    {

      // Perform forward movement.

      vec3.add(

          camera_position_vector,
          camera_position_vector,
          vec3.scale( vec3.create( ), camera_direction_vector, time_delta )

      );

    }

    if ( camera_keys[ 1 ] )
    {

      // Perform backward movement.

      vec3.sub(

          camera_position_vector,
          camera_position_vector,
          vec3.scale( vec3.create( ), camera_direction_vector, time_delta )

      );

    }

    if ( camera_keys[ 2 ] )
    {

      // Perform left movement.

      camera_sideways_vector = vec3.cross( vec3.create( ), camera_direction_vector, camera_up_vector );

      vec3.sub(

          camera_position_vector,
          camera_position_vector,
          vec3.scale( vec3.create( ), camera_sideways_vector, time_delta )

      );

    }

    if ( camera_keys[ 3 ] )
    {

      // Perform right movement.

      camera_sideways_vector = vec3.cross( vec3.create( ), camera_direction_vector, camera_up_vector );

      vec3.add(

          camera_position_vector,
          camera_position_vector,
          vec3.scale( vec3.create( ), camera_sideways_vector, time_delta )

      );

    }

    if ( camera_keys[ 4 ] )
    {

      // Perform up movement.

      vec3.add(

          camera_position_vector,
          camera_position_vector,
          vec3.scale( vec3.create( ), camera_up_vector, time_delta )

      );

    }

    if ( camera_keys[ 5 ] )
    {

      // Perform up movement.

      vec3.sub(

          camera_position_vector,
          camera_position_vector,
          vec3.scale( vec3.create( ), camera_up_vector, time_delta )

      );

    }

  }

  // Generate the view matrix based on the camera.

  var look_at_point_vector = vec3.add( vec3.create( ), camera_position_vector, camera_direction_vector );

  view_matrix = mat4.lookAt( mat4.identity( view_matrix ), camera_position_vector, look_at_point_vector, camera_up_vector );

  // Translate the light's position based on the view matrix.

  var light_position_vector = vec3.set( vec3.create( ), -4.2, 1.0, 0.0 );

  vec3.transformMat4( light_position_vector, light_position_vector, view_matrix );

  // Pass the shaders the light information.

  gl.uniform3f( shaderProgram.ambientColorUniform, 0.123, 0.154, 0.182 );

  gl.uniform3f(
    shaderProgram.pointLightLocationUniform,
    light_position_vector[ 0 ],
    light_position_vector[ 1 ],
    light_position_vector[ 2 ]
  );

  gl.uniform3f( shaderProgram.pointLightColorUniform, 1.0, 0.796, 0.671 );

  // Pass the shaders the screen size.

  gl.uniform2f( shaderProgram.screenSizeUniform, gl.viewportWidth, gl.viewportHeight );

  // For rotating the pyramids per frame.

  rotation_radians += rotation_radians_step * time_delta;

  if ( rotation_radians > ( Math.PI * 2 ) ) rotation_radians = 0.0;

  // The model matrix.

  // Move to the 3D origin.

  mat4.identity( model_matrix );

  // First pyramid.

  // Save the current model matrix for later use.

  push_model_matrix( );

  // Rotate the model matrix thereby rotating the Sierpinski pyramid.

  mat4.rotate( model_matrix, model_matrix, -0.5, [ 0, 1, 0 ] );

  mat4.rotate( model_matrix, model_matrix, -rotation_radians, [ 0, 1, 0 ] );
  mat4.rotate( model_matrix, model_matrix,  rotation_radians, [ 0, 0, 1 ] );
  mat4.rotate( model_matrix, model_matrix, -rotation_radians, [ 1, 0, 0 ] );

  // Pass to the shaders the pyramid data.

  gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexPositionBuffer );
  gl.vertexAttribPointer( shaderProgram.vertexPositionAttribute, pyramidVertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0 );

  gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexNormalBuffer );
  gl.vertexAttribPointer( shaderProgram.vertexNormalAttribute,   pyramidVertexNormalBuffer.itemSize,   gl.FLOAT, false, 0, 0 );

  gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexColorBuffer );
  gl.vertexAttribPointer( shaderProgram.vertexColorAttribute,    pyramidVertexColorBuffer.itemSize,    gl.FLOAT, false, 0, 0 );

  // Create the model-view matrix. MV = V * M

  mat4.multiply( mvMatrix, view_matrix, model_matrix );

  // Pass to the shaders the perspective and the model-view matrix.

  setMatrixUniforms( );

  // Render the pyramid to the screen.

  gl.drawArrays( gl.TRIANGLES, 0, pyramidVertexPositionBuffer.numItems );

  // Restore the previous state of the model matrix.

  pop_model_matrix( );

  // Second pyramid.

  if ( subdivide_count !== 0 )
  {

    // Save the model matrix.

    push_model_matrix( );

    // Scale it.

    mat4.scale( model_matrix, model_matrix, [ 0.3, 0.3, 0.3 ] );

    // Rotate it.

    mat4.rotate( model_matrix, model_matrix, -0.50, [ 0, 1, 0 ] );

    mat4.rotate( model_matrix, model_matrix,  rotation_radians, [ 0, 1, 0 ] );
    mat4.rotate( model_matrix, model_matrix, -rotation_radians, [ 0, 0, 1 ] );
    mat4.rotate( model_matrix, model_matrix,  rotation_radians, [ 1, 0, 0 ] );

    // Pass the pyramid data to the shaders.

    gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexPositionBuffer );
    gl.vertexAttribPointer( shaderProgram.vertexPositionAttribute, pyramidVertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0 );

    gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexNormalBuffer );
    gl.vertexAttribPointer( shaderProgram.vertexNormalAttribute,   pyramidVertexNormalBuffer.itemSize,   gl.FLOAT, false, 0, 0 );

    gl.bindBuffer( gl.ARRAY_BUFFER, pyramidVertexColorBuffer );
    gl.vertexAttribPointer( shaderProgram.vertexColorAttribute,    pyramidVertexColorBuffer.itemSize,    gl.FLOAT, false, 0, 0 );

    // Create the model-view matrix. MV = V * M

    mat4.multiply( mvMatrix, view_matrix, model_matrix );

    // Pass to the shaders the perspective and the model-view matrix.

    setMatrixUniforms( );

    // Draw it.

    gl.drawArrays( gl.TRIANGLES, 0, pyramidVertexPositionBuffer.numItems );

    // Restore the model matrix.

    pop_model_matrix( );

  }

  // Save the model matrix.

  push_model_matrix( );

  // Shrink the cube.

  mat4.scale( model_matrix, model_matrix, [ 0.2, 0.2, 0.2 ] );

  // Translate it.

  mat4.translate( model_matrix, model_matrix, [ -5.0, 1.0, 0.0 ] );

  // Pass the cube data to the shaders.

  gl.bindBuffer( gl.ARRAY_BUFFER, cubeVertexPositionBuffer );
  gl.vertexAttribPointer( shaderProgram.vertexPositionAttribute, cubeVertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0 );

  gl.bindBuffer( gl.ARRAY_BUFFER, cubeVertexNormalBuffer );
  gl.vertexAttribPointer( shaderProgram.vertexNormalAttribute,   cubeVertexNormalBuffer.itemSize,   gl.FLOAT, false, 0, 0 );

  gl.bindBuffer( gl.ARRAY_BUFFER, cubeVertexColorBuffer );
  gl.vertexAttribPointer( shaderProgram.vertexColorAttribute,    cubeVertexColorBuffer.itemSize,    gl.FLOAT, false, 0, 0 );

  gl.bindBuffer( gl.ELEMENT_ARRAY_BUFFER, cubeVertexIndexBuffer );

  // Create the model-view matrix. MV = V * M

  mat4.multiply( mvMatrix, view_matrix, model_matrix );

  // Pass to the shaders the perspective and the model-view matrix.

  setMatrixUniforms( );

  // Draw it.

  gl.drawElements( gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0 );

  // Restore the model matrix.

  pop_model_matrix( );

}

function resize_contents( )
{

  // The browser window has been re-sized so re-size the render window and onscreen elements.

  var logo_image      = document.getElementById( "logo" );
  logo_image_height   = logo_image.clientHeight;
  logo_image_width    = logo_image.clientWidth;

  var logo_box        = document.getElementById( "logo_box" );
  logo_box.style.top  = window.innerHeight - logo_image_height - 10 + "px";
  logo_box.style.left = window.innerWidth  - logo_image_width  - 10 + "px";

  var canvas    = document.getElementById( "webgl_canvas" );
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  gl.viewportWidth  = canvas.width;
  gl.viewportHeight = canvas.height;

}

function webGLStart( )
{

  // Create and add the canvas that will be "painted" on or rather rendered to by WebGL.

  canvas        = document.createElement( "canvas" );
  canvas.id     = "webgl_canvas";
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild( canvas );

  // GLSL shaders.

  // You could write these in scripts tags (<script>// GLSL CODE</script>) in the HTML file
  // and then reference them here. You could also write them in separate JS files and reference
  // them here. Here they are created dynamically by adding scripts on-the-fly to the DOM after
  // the window has already been loaded. Notice how the "index.html" source file contains no
  // embeded JS but at run time they are there. Hence the defining of the inner HTML of the
  // script object and the string concatenation. This allows for greater flexibility and code
  // comprehension as all scripts are in one JS file "index.js".

  // Vertex shader GLSL code.

  var vertex_shader         = document.createElement( "script" );
  vertex_shader.id          = "shader-vs";
  vertex_shader.type        = "x-shader/x-vertex";
  vertex_shader.innerHTML   = "precision mediump float;";
  vertex_shader.innerHTML  += "attribute vec3 aVertexPosition;";
  vertex_shader.innerHTML  += "attribute vec3 aVertexNormal;";
  vertex_shader.innerHTML  += "attribute vec4 aVertexColor;";
  vertex_shader.innerHTML  += "uniform mat4 uMVMatrix;";
  vertex_shader.innerHTML  += "uniform mat4 uPMatrix;";
  vertex_shader.innerHTML  += "uniform mat3 uNMatrix;";
  vertex_shader.innerHTML  += "varying vec4 vPosition;";
  vertex_shader.innerHTML  += "varying vec4 vDiffuseColor;";
  vertex_shader.innerHTML  += "varying vec3 vTransformedNormal;";
  vertex_shader.innerHTML  += "void main( void ) {";
  vertex_shader.innerHTML  += "     vDiffuseColor      = aVertexColor;";
  vertex_shader.innerHTML  += "     vTransformedNormal = uNMatrix  * aVertexNormal;"; // Transformed surface normal.
  vertex_shader.innerHTML  += "     vPosition          = uMVMatrix * vec4( aVertexPosition, 1.0 );";
  vertex_shader.innerHTML  += "     gl_Position        = uPMatrix  * vPosition;"; // The vertex's final position.
  vertex_shader.innerHTML  += "}";
  document.body.appendChild( vertex_shader );

  // Fragment shader GLSL code.

  var fragment_shader         = document.createElement( "script" );
  fragment_shader.id          = "shader-fs";
  fragment_shader.type        = "x-shader/x-fragment";
  fragment_shader.innerHTML   = "precision mediump float;";
  fragment_shader.innerHTML  += "uniform vec3 uAmbientColor;";
  fragment_shader.innerHTML  += "uniform vec3 uPointLightLocation;";
  fragment_shader.innerHTML  += "uniform vec3 uPointLightColor;";
  fragment_shader.innerHTML  += "uniform vec2 uSreenSize;";
  fragment_shader.innerHTML  += "varying vec3 vTransformedNormal;";
  fragment_shader.innerHTML  += "varying vec4 vPosition;";
  fragment_shader.innerHTML  += "varying vec4 vDiffuseColor;";
  fragment_shader.innerHTML  += "void main( void ) {";
  fragment_shader.innerHTML  += "     vec3 uAmbientColor    = pow(uAmbientColor.rgb, vec3(2.2));";
  fragment_shader.innerHTML  += "     vec4 vDiffuseColor    = vDiffuseColor; vDiffuseColor.rgb = pow(vDiffuseColor.rgb, vec3(2.2));";
  fragment_shader.innerHTML  += "     vec3 uPointLightColor = pow(uPointLightColor.rgb, vec3(2.2));";
  fragment_shader.innerHTML  += "     vec3 groundLightColor = pow(vec3(0.173, 0.180, 0.301), vec3(2.2));";
  fragment_shader.innerHTML  += "     vec3 skyLightColor    = pow(vec3(0.411, 0.279, 0.236), vec3(2.2));";
  fragment_shader.innerHTML  += "     vec3 light_direction  =  normalize( uPointLightLocation - vPosition.xyz );";
  fragment_shader.innerHTML  += "     vec3 eye_direction    = -normalize( vPosition.xyz );";
  fragment_shader.innerHTML  += "     vec3 half_vector      =  normalize( light_direction + eye_direction );";
  fragment_shader.innerHTML  += "     vec3 surface_normal;";
  fragment_shader.innerHTML  += "     if ( gl_FrontFacing ) {";
  fragment_shader.innerHTML  += "       surface_normal =  normalize( vTransformedNormal );";
  fragment_shader.innerHTML  += "     }";
  fragment_shader.innerHTML  += "     else {";
  fragment_shader.innerHTML  += "       surface_normal = -normalize( vTransformedNormal );";
  fragment_shader.innerHTML  += "     }";
  fragment_shader.innerHTML  += "           uAmbientColor       = mix(groundLightColor, skyLightColor, 0.5 * (1.0 + dot(surface_normal, vec3(0, 1, 0))));";
  fragment_shader.innerHTML  += "     float diffuse_intensity   = max( dot( surface_normal, light_direction ), 0.0 );";
  fragment_shader.innerHTML  += "     float light_outer_radius  =  5.0;";
  fragment_shader.innerHTML  += "     float light_inner_radius  =  4.0;";
  fragment_shader.innerHTML  += "     float light_distance      = length( vPosition.xyz - uPointLightLocation );";
  fragment_shader.innerHTML  += "     float attenuation         = (1.0 - smoothstep( light_inner_radius, light_outer_radius, light_distance )) * 3.0;";
  fragment_shader.innerHTML  += "     vec3  ambient             = vDiffuseColor.rgb * uAmbientColor;";
  fragment_shader.innerHTML  += "     vec3  diffuse             = vDiffuseColor.rgb * uPointLightColor * diffuse_intensity;";
  fragment_shader.innerHTML  += "     vec3  specular            = vec3( 0.0 );";
  fragment_shader.innerHTML  += "     float specular_intentsity = 0.0;";
  fragment_shader.innerHTML  += "     if ( diffuse_intensity > 0.0 ) {";
  fragment_shader.innerHTML  += "          specular_intentsity = max( dot( surface_normal, half_vector ), 0.0 );";
  fragment_shader.innerHTML  += "          specular            = uPointLightColor * pow( specular_intentsity, 50.0 );";
  fragment_shader.innerHTML  += "     }";
  fragment_shader.innerHTML  += "     diffuse           = attenuation * diffuse;";
  fragment_shader.innerHTML  += "     specular          = attenuation * specular;";
  fragment_shader.innerHTML  += "     vec4 final_color  = vec4( ambient + diffuse + specular, 1.0 );";
  fragment_shader.innerHTML  += "     vec4  fog_color   = vec4(mix(groundLightColor, skyLightColor, gl_FragCoord.y / uSreenSize.y), 1.0);";
  fragment_shader.innerHTML  += "     float fog         = smoothstep( 5.0, 10.0, abs(vPosition.z) );";
  fragment_shader.innerHTML  += "     gl_FragColor      = mix( final_color, fog_color, fog );";
  fragment_shader.innerHTML  += "     gl_FragColor.rgb  = pow(gl_FragColor.rgb, vec3(1.0 / 2.2));";
  fragment_shader.innerHTML  += "}";
  document.body.appendChild( fragment_shader );

  initGL( canvas ); // Initialize WebGL.
  initShaders( );   // Initialize the shaders.
  initBuffers( );   // Initialize the 3D shapes.
  initHUD( );       // Initialize the onscreen elements.
  initControls( );  // Initialize the onscreen controls.

  gl.clearColor( 0.173, 0.180, 0.301, 0.0 ); // Set the WebGL background color.
  gl.enable( gl.DEPTH_TEST ); // Enable the depth buffer.

  window.requestAnimationFrame( draw_scene ); // Begin rendering animation.

}

// Helper functions.

function get_average( values )
{

  if ( values.length === 0 ) return 0;

  var i = values.length;

  var total = 0.0;

  while ( i-- )
  {

    total += values[ i ];

  }

  return total / values.length;

}

function get_remainder( dividend, divisor )
{

  return ( ( dividend % divisor ) + divisor ) % divisor;

}
